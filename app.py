"""Visualisation pédagogique : comprendre à quoi servent les explications de prédiction de retard.

Lancer : streamlit run app.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent / "src"))
from artimation.data import DESCRIPTIONS, FEATURE_GROUP, FEATURES  # noqa: E402
from artimation.webapp import build_html  # noqa: E402
from artimation.experiment import ARTIFACTS, load, run, save  # noqa: E402

st.set_page_config(page_title="ARTIMATION · XAI retard au décollage", layout="wide")

PAPER = {
    "t1": {"CBR": (5.88, 1.48, 0.52), "XGB": (9.22, 4.28, 2.72)},
    "t2": {"SHAP": (3.3e-6, 1.1e-6, 6.2e-7), "LIME": (8.62, 4.75, 3.13)},
    "t3_add": {"SHAP": (0.81, 0.81, 0.82), "LIME": (0.82, 0.81, 0.77)},
    "t3_gl": {"SHAP": (0.74, 0.72, 0.72), "LIME": (0.88, 0.85, 0.80)},
}
COLORS = {"XGB": "#d95f02", "CBR": "#1b9e77", "SHAP": "#7570b3", "LIME": "#e7298a"}


@st.cache_resource(show_spinner="Entraînement des modèles (première fois seulement)…")
def get_results():
    path = ARTIFACTS / "results.pkl"
    if path.exists():
        res = load()
        if "discretize_lime" in res.get("config", {}):
            return res
    res = run(verbose=False)
    save(res)
    return res


R = get_results()
test, train = R["test"], R["train"]

st.title("Pourquoi l'IA prédit-elle ce retard ?")
st.caption("Réimplémentation de « When a CBR in Hand is Better than Twins in the Bush » (Ahmed et al., XCBR'22) · projet SESAR ARTIMATION · données synthétiques")

tab0, tab1, tab2, tab3, tab4, tab5 = st.tabs(["1 · Comprendre", "2 · Prédire", "3 · Expliquer un vol", "4 · Poids globaux", "5 · SHAP vs LIME", "6 · Studio conflits (2D / 3D)"])

# ----------------------------------------------------------------------------------------------
with tab0:
    st.header("À quoi ça sert ?")
    st.markdown(
        """
**Le problème.** Un avion qui décolle en retard propage ce retard à tout le réseau (coût moyen ≈ 100 € la minute pour une compagnie).
Prédire l'heure de décollage aide les contrôleurs aériens (ATCO) à planifier. Mais un modèle d'apprentissage automatique est une
**boîte noire** : si on ne sait pas *pourquoi* il annonce « +23 min », un contrôleur ne lui fera pas confiance. C'est l'enjeu du projet
**ARTIMATION** : une IA *transparente* pour la gestion du trafic aérien.

**Ce que fait l'article, en trois modèles :**
1. **XGBoost** — le modèle précis mais opaque : 500 arbres de décision empilés. Il prédit le retard.
2. **CBR (raisonnement à partir de cas)** — le modèle interprétable : *« ce vol ressemble à ces 3 vols passés, qui ont eu tel retard »*.
   La ressemblance utilise des poids par variable repris de l'importance XGBoost. Explication naturelle : on montre les 3 vols voisins.
3. **SHAP et LIME** — deux méthodes qui expliquent XGBoost en attribuant à chaque variable une contribution en minutes
   (*« le retard du vol précédent ajoute +12 min, la météo +3 min… »*).

**La question posée :** SHAP et LIME donnent-elles des explications fidèles (précision locale) et cohérentes avec celles du CBR (nDCG) ?

**Comment lire cette app :** l'onglet 3 est le cœur : choisissez un vol, voyez les 3 explications côte à côte, et testez des scénarios « et si… ».
        """
    )
    c = R["config"]
    st.info(
        f"**Données synthétiques.** Les vraies données EUROCONTROL (5,9 M de vols, 2019) ne sont pas publiques. "
        f"Un générateur reproduit leur structure (42 variables : vol, vol précédent, régulation ATFM, météo, aéroports) — "
        f"{c['n_train']:,} vols d'entraînement, {c['n_test']:,} de test. Les chiffres diffèrent donc de ceux du papier ; "
        f"c'est la méthode qui est reproduite, pas les valeurs."
    )
    st.subheader("Glossaire")
    st.markdown(
        "- **EOBT** : heure estimée de sortie de parking. · **ATFM** : régulation des flux, impose parfois un retard.\n"
        "- **MAE** : erreur absolue moyenne, en minutes (plus bas = mieux).\n"
        "- **Précision locale** : l'explication, additionnée, retrouve-t-elle la prédiction du modèle ? (écart en minutes, plus bas = mieux)\n"
        "- **nDCG** : l'ordre des variables jugées importantes est-il le même que celui du CBR ? (0 à 1, plus haut = mieux)"
    )

# ----------------------------------------------------------------------------------------------
with tab1:
    st.header("Quelle est la précision des modèles ?")
    y, e_x, e_c = R["y_test"], R["err_xgb"], R["err_cbr"]
    c1, c2, c3 = st.columns(3)
    c1.metric("MAE XGBoost", f"{e_x.mean():.2f} min")
    c2.metric("MAE CBR", f"{e_c.mean():.2f} min")
    c3.metric("Papier (XGB / CBR)", "9,22 / 5,88 min")
    st.info(
        "**Comparaison avec le papier :** sur les données ETFMS d'EUROCONTROL comme sur notre catalogue de situations "
        "opérationnelles récurrentes, **le CBR ($k=3$) bat XGBoost** : deux vols partageant la même rotation, le même "
        "créneau de hub et la même régulation ATFM subissent le même régime de retard local que les 3 plus proches "
        "voisins retrouvent directement, tandis que les arbres de profondeur 7 lissent ces effets."
    )
    bins = [0, 2, 5, 10, 20, 30, 50, 1e9]
    labels = ["<2", "2–5", "5–10", "10–20", "20–30", "30–50", "50+"]
    h = pd.DataFrame({m: pd.cut(e, bins, right=False, labels=labels).value_counts().reindex(labels) for m, e in [("XGB", e_x), ("CBR", e_c)]})
    fig = px.bar(h.reset_index(names="erreur (min)").melt("erreur (min)", var_name="modèle", value_name="vols"),
                 x="erreur (min)", y="vols", color="modèle", barmode="group", color_discrete_map=COLORS,
                 title="Nombre de vols par tranche d'erreur de prédiction")
    st.plotly_chart(fig, width='stretch')
    rows = []
    for m, e in [("XGB", e_x), ("CBR", e_c)]:
        s = np.sort(e)
        for i, sub in enumerate(["All", "100k", "67k"]):
            rows.append({"modèle": m, "sous-ensemble": sub, "MAE (ici)": R["table1"][m][sub][0], "σ (ici)": R["table1"][m][sub][1], "MAE (papier)": PAPER["t1"][m][i]})
    st.caption("Table 1 · « 100k » et « 67k » = les 63,6 % / 42,7 % d'instances les plus précises (mêmes proportions que le papier).")
    st.dataframe(pd.DataFrame(rows).round(2), hide_index=True, width='stretch')

# ----------------------------------------------------------------------------------------------
with tab2:
    st.header("Expliquer la prédiction d'un vol")
    ex = R["explain_idx"]
    sel = st.selectbox("Vol à expliquer", range(len(ex)), format_func=lambda i: f"vol #{ex[i]} · retard réel {test['delay'].iloc[ex[i]]:+.0f} min · prédit {R['xgb_pred'][ex[i]]:+.0f} min")
    ti = ex[sel]
    row = test.iloc[ti]
    cbr, xgb = R["cbr"], R["xgb"]

    st.subheader("Scénario « et si… » (modifie le vol et re-prédit)")
    cols = st.columns(4)
    edit = {}
    for col, f, lo, hi in zip(cols, ["prev_leg_delay", "atfm_regulation_delay", "dep_visibility", "last_hour_avg_delay"],
                              [0, 0, 0.3, 0], [90, 60, 10, 40]):
        edit[f] = col.slider(DESCRIPTIONS.get(f, f), float(lo), float(hi), float(np.clip(row[f], lo, hi)), key=f"{f}{ti}")
    x = row[FEATURES].to_numpy(dtype=float).copy()
    modified = any(abs(edit[f] - row[f]) > 1e-9 for f in edit)
    for f, v in edit.items():
        x[FEATURES.index(f)] = v
    if edit["atfm_regulation_delay"] > 0:
        x[FEATURES.index("atfm_regulation_active")] = 1.0
    X1 = x[None]
    import shap as _shap
    exp = _shap.TreeExplainer(xgb)
    phi_s = exp.shap_values(X1)[0]
    pred_x, pred_c = float(xgb.predict(X1)[0]), float(cbr.predict(X1)[0])
    phi_c = cbr.additive_attributions(X1, np.array([pred_c]))[0]
    if not modified:
        k = list(ex).index(ti)
        phi_l = R["phi_lime"][k]
    else:
        from artimation.explain import lime_explain
        phi_l = lime_explain(xgb, train[FEATURES].to_numpy()[:20000], X1, FEATURES)[0][0]

    m1, m2, m3 = st.columns(3)
    m1.metric("Retard réel (original)", f"{row['delay']:+.1f} min")
    m2.metric("XGBoost", f"{pred_x:+.1f} min")
    m3.metric("CBR", f"{pred_c:+.1f} min")

    top = st.slider("Nombre de variables affichées", 5, 20, 10)
    cc = st.columns(3)
    for col, (name, phi, note) in zip(cc, [
        ("SHAP", phi_s, f"valeur de base {exp.expected_value:+.1f} + Σ contributions = prédiction XGBoost"),
        ("LIME", phi_l, "approximation linéaire locale (coefficients × variables)"),
        ("CBR additif", phi_c, "part de chaque variable dans la ressemblance pondérée"),
    ]):
        idx = np.argsort(-np.abs(phi))[:top][::-1]
        fig = go.Figure(go.Bar(x=phi[idx], y=[FEATURES[i] for i in idx], orientation="h",
                               marker_color=[COLORS.get(name.split()[0], "#1b9e77") if v >= 0 else "#999" for v in phi[idx]]))
        fig.update_layout(title=name, height=420, margin=dict(l=0, r=0, t=40, b=0), xaxis_title="contribution (min)")
        col.plotly_chart(fig, width='stretch')
        col.caption(note)

    st.subheader("Explication par l'exemple : les 3 vols les plus semblables (CBR)")
    _, nb = cbr.neighbors(X1)
    cols_show = ["delay"] + [f for f in np.array(FEATURES)[np.argsort(-R["weights"])[:6]]]
    nbr = train.iloc[nb[0]][cols_show].copy()
    nbr.insert(0, "vol", ["voisin 1", "voisin 2", "voisin 3"])
    cur = pd.DataFrame([[ "ce vol", *[row['delay'] if not modified else np.nan], *[x[FEATURES.index(f)] for f in cols_show[1:]]]], columns=nbr.columns)
    st.dataframe(pd.concat([cur, nbr]).round(2), hide_index=True, width='stretch')
    st.caption(f"Le CBR prédit la moyenne des retards des 3 voisins = {pred_c:+.1f} min. Un contrôleur peut juger lui-même si ces vols sont vraiment comparables.")

# ----------------------------------------------------------------------------------------------
with tab3:
    st.header("Quelles variables comptent globalement ?")
    st.markdown("Importances XGBoost = **poids du CBR**. Une seule valeur par variable : facile à lire, et un expert peut les corriger à la main (ex. renforcer le retard du vol précédent).")
    w = pd.DataFrame({"variable": FEATURES, "poids": R["weights"]})
    w["groupe"] = w["variable"].map(FEATURE_GROUP)
    w = w.sort_values("poids")
    fig = px.bar(w.tail(25), x="poids", y="variable", color="groupe", orientation="h", height=620)
    st.plotly_chart(fig, width='stretch')
    g = w.groupby("groupe")["poids"].sum().sort_values(ascending=False)
    st.plotly_chart(px.pie(g.reset_index(), values="poids", names="groupe", title="Poids par famille de variables"), width='stretch')

# ----------------------------------------------------------------------------------------------
with tab4:
    st.header("SHAP ou LIME : laquelle est fidèle ?")
    ex = R["explain_idx"]
    xp = R["xgb_pred"][ex]
    c1, c2 = st.columns(2)
    for col, (name, pred) in zip([c1, c2], [("SHAP", R["shap_pred"]), ("LIME", R["lime_pred"])]):
        fig = px.scatter(x=xp, y=pred, labels={"x": "prédiction XGBoost (min)", "y": f"prédiction reconstruite par {name} (min)"},
                         title=f"{name} · précision locale (MAE {np.abs(xp - pred).mean():.2g} min)", color_discrete_sequence=[COLORS[name]])
        lo, hi = float(min(xp.min(), pred.min())), float(max(xp.max(), pred.max()))
        fig.add_shape(type="line", x0=lo, y0=lo, x1=hi, y1=hi, line=dict(dash="dash", color="grey"))
        col.plotly_chart(fig, width='stretch')
    st.markdown("**Lecture :** SHAP retrouve exactement la prédiction (points sur la diagonale) ; LIME en reste proche mais s'écarte de plusieurs minutes — c'est la conclusion du papier.")
    sub = ["All", "100k", "67k"]
    t2 = pd.DataFrame([{"méthode": m, "sous-ensemble": s, "MAE ici": R["table2"][m][s][0], "MAE papier": PAPER["t2"][m][i]} for m in ("SHAP", "LIME") for i, s in enumerate(sub)])
    st.caption("Table 2 · précision locale")
    st.dataframe(t2.style.format({"MAE ici": "{:.3g}", "MAE papier": "{:.3g}"}), hide_index=True, width='stretch')
    t3 = pd.DataFrame([{"méthode": m, "référence": ref, "sous-ensemble": s, "nDCG ici": R["table3"][m][ref][s],
                        "nDCG papier": PAPER["t3_add" if ref == "Additive CBR" else "t3_gl"][m][i]}
                       for m in ("SHAP", "LIME") for ref in ("Global CBR", "Additive CBR") for i, s in enumerate(sub)])
    st.caption("Table 3 · nDCG : accord de l'ordre des variables avec le CBR (référence)")
    st.dataframe(t3.round(2), hide_index=True, width='stretch')
    with st.expander("Pourquoi nos résultats se rapprochent-ils de l'article (et d'où viennent les écarts résiduels) ?"):
        st.markdown(
            "1. **Poids globaux en gain total (`importance_type='total_gain'`)** : l'importance par défaut de XGBoost "
            "(`gain` moyen par coupure) gonfle artificiellement les variables binaires rares coupées une seule fois. "
            "Le gain total reflète la vraie part de variance expliquée par chaque variable et aligne les classements "
            "du CBR, de SHAP et de LIME en **Table 3**.\n"
            "2. **Asymétrie SHAP vs LIME en Table 3** : LIME ajuste une régression linéaire locale sur un noyau large "
            "($\\sigma = 0{,}75\\sqrt{d}$), dont les pentes suivent la hiérarchie globale moyenne (**LIME > SHAP sur "
            "Global CBR**). À l'inverse, SHAP attribue une contribution proportionnelle à l'écart de chaque variable "
            "sur le vol considéré, ce qui l'aligne avec $\\gamma_i x_{ij} w_j$ (**SHAP > LIME sur Additive CBR**).\n"
            "3. **Courbure non linéaire en Table 2** : lorsque plusieurs facteurs de retard se cumulent, l'amplification "
            "non linéaire écarte l'approximation linéaire locale de LIME de plusieurs minutes (`All` > `100k` > `67k`), "
            "tandis que SHAP reste exact ($\\sim 10^{-5}$ min).\n"
            "4. **Écart résiduel avec les chiffres exacts du papier** : les vraies données EUROCONTROL ETFMS 2019 "
            "(5,9 M de vols, 158 147 vols expliqués avec KernelSHAP) sont privées ; notre générateur synthétique "
            "(`data.py`) en reproduit la structure par cas opérationnels à l'échelle de 80 000 vols."
        )


# ----------------------------------------------------------------------------------------------
@st.cache_data(show_spinner=False)
def _studio_page():
    return build_html()


with tab5:
    st.markdown(
        "**Vector+** : l'outil de l'ENAC (C. Hurter), étendu à l'altitude, avec l'algorithme génétique de Hurter et al. 2022, la HeatMap, et une vue 3D. "
        "Une seule situation, une seule fenêtre : **2D ou 3D**. Placer des avions (clic), les glisser, orienter leur vecteur, **Lecture**, lancer l'algorithme."
    )
    st.iframe(_studio_page(), height=1500)
    st.download_button("Télécharger l'outil (page HTML autonome, fonctionne hors ligne)", _studio_page(), file_name="vector-plus.html", mime="text/html")

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
from artimation import zenodo  # noqa: E402
from artimation.conflict import SEP_NM, evaluate, heat_layers, instructions, list_scenarios, maneuver_path, separation_curves  # noqa: E402
from artimation.experiment import ARTIFACTS, load, run, save  # noqa: E402
from artimation.ga import GAConfig, run_ga  # noqa: E402

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
    if not path.exists():
        save(run(verbose=False))
    return load()


R = get_results()
test, train = R["test"], R["train"]

st.title("Pourquoi l'IA prédit-elle ce retard ?")
st.caption("Réimplémentation de « When a CBR in Hand is Better than Twins in the Bush » (Ahmed et al., XCBR'22) · projet SESAR ARTIMATION · données synthétiques")

tab0, tab1, tab2, tab3, tab4, tab5 = st.tabs(["1 · Comprendre", "2 · Prédire", "3 · Expliquer un vol", "4 · Poids globaux", "5 · SHAP vs LIME", "6 · Conflits : algorithme génétique"])

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
    st.warning(
        "Écart avec le papier : ici **XGBoost bat le CBR**, alors que l'article trouve l'inverse sur les vraies données. "
        "Avec plus de données d'entraînement (jusqu'à 1 M testé) l'écart ne se résorbe pas. Sur nos données synthétiques, "
        "la fonction de retard est lisse avec un bruit à queues lourdes : les arbres le gèrent mieux que la moyenne de 3 voisins. "
        "Ce n'est pas un bug mais une limite du jeu simulé."
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
    st.caption("SHAP est utilisé via TreeSHAP exact (le papier emploie KernelSHAP) ; 500 vols expliqués.")


# ----------------------------------------------------------------------------------------------
SCENARIOS = {sc.name: sc for sc in list_scenarios()}
AC_COLORS = ["#1f77b4", "#ff7f0e", "#9467bd"]


@st.cache_data(show_spinner="L'algorithme génétique évolue…")
def ga_run(name, seed, pop, gens):
    r = run_ga(SCENARIOS[name], GAConfig(pop=pop, generations=gens, seed=seed))
    return r.genes, r.generation, r.fitness, r.pair_dmin, r.best_genes


@st.cache_data(show_spinner="Lecture des solutions de l'ENAC…")
def enac_run(name):
    s = SCENARIOS[name]
    genes, fit, dmin, gen, best = zenodo.load_run(s, int("".join(c for c in name if c.isdigit())))
    return genes, gen, fit, zenodo.pair_dmin(s, genes), best


@st.cache_data
def heat(name, genes_key, _genes, _pd):
    return heat_layers(SCENARIOS[name], _genes, _pd)


def route_traces(scn, genes, with_original=True):
    out = []
    for i, r in enumerate(scn.routes):
        if with_original:
            out.append(go.Scatter(x=r.xy[:, 0], y=r.xy[:, 1], mode="lines", line=dict(color="#888", dash="dot", width=1), name=f"route {i + 1}", showlegend=False))
        xy, _ = maneuver_path(r, genes[i])
        out.append(go.Scatter(x=xy[:, 0], y=xy[:, 1], mode="lines+markers", line=dict(color=AC_COLORS[i], width=3),
                              marker=dict(size=6), name=f"avion {i + 1}"))
        out.append(go.Scatter(x=[r.xy[0, 0]], y=[r.xy[0, 1]], mode="markers+text", text=[f"✈{i + 1}"], textposition="top center",
                              marker=dict(size=1, color=AC_COLORS[i]), showlegend=False))
    return out


def map_layout(fig, scn, title):
    lo, hi = scn.bounds(10)
    fig.update_layout(title=title, height=520, margin=dict(l=0, r=0, t=40, b=0), legend=dict(orientation="h"),
                      xaxis=dict(range=[lo[0], hi[0]], title="x (NM)"), yaxis=dict(range=[lo[1], hi[1]], scaleanchor="x", title="y (NM)"))
    return fig


with tab5:
    st.header("Résoudre un conflit aérien avec un algorithme génétique")
    st.markdown(
        """
Réimplémentation de **« Usage of more Transparent and Explainable Conflict Resolution Algorithm: Air Traffic Controller Feedback »**
(Hurter, Degas, Durand, Guibert, Ahmed, Begum… · *Transportation Research Procedia* 66, 2022), second cas d'usage d'ARTIMATION.

**Le problème.** Plusieurs avions convergent vers le même point au même moment : s'ils ne font rien, ils passent à moins de 7 NM
(≈ 13 km) les uns des autres, c'est un *conflit*. Il faut modifier leurs trajectoires le moins possible.

**L'algorithme génétique** imite l'évolution : une *population* de 100 solutions candidates (une manœuvre par avion : *à quel instant
tourner, de quel angle, quand revenir sur la route*), notées par une **fitness** (durée des conflits, longueur ajoutée, nombre de manœuvres).
À chaque génération, les meilleures se *croisent* (on échange des manœuvres entre deux solutions) et *mutent* (on les perturbe un peu).
Après 100 générations, la meilleure est proposée au contrôleur.

**Pourquoi l'expliquer ?** Un contrôleur qui ne voit que *la* solution (**BlackBox**) doit lui faire confiance aveuglément.
Avec la **HeatMap**, il voit *tout ce que l'algorithme a exploré* : en **vert** les modifications sûres, en **rouge** les dangereuses.
Il comprend la marge de manœuvre, et peut en choisir une autre. Dans l'étude suivante (21 contrôleurs, EEG), la HeatMap réduit leur charge mentale.
        """
    )
    c1, c2, c3 = st.columns([2, 2, 2])
    name = c1.selectbox("Scénario (vols réels de 2016, ENAC)", list(SCENARIOS), index=1)
    scn = SCENARIOS[name]
    k = int("".join(ch for ch in name if ch.isdigit()))
    sources = ["Mon algorithme génétique (réimplémenté)"] + (["Algorithme original de l'ENAC (données Zenodo)"] if zenodo.available(k) else [])
    src = c2.radio("Source des solutions", sources)
    seed = c3.number_input("Graine aléatoire", 0, 999, 0)
    if len(sources) == 1:
        st.caption("Pour comparer avec l'algorithme original : `python scripts/fetch_zenodo.py` (49 Mo), puis relancer l'app.")
    genes_all, gen_all, fit_all, pd_all, best = enac_run(name) if src != sources[0] else ga_run(name, int(seed), 100, 100)
    ev = evaluate(scn, best)
    dmin_all = np.array([p[np.isfinite(p)].min() for p in pd_all])

    m = st.columns(4)
    m[0].metric("Candidats explorés", f"{len(genes_all):,}")
    m[1].metric("Part de solutions sûres", f"{(dmin_all >= SEP_NM).mean():.0%}")
    m[2].metric("Séparation minimale retenue", f"{ev.dmin:.1f} NM", f"seuil {SEP_NM:.0f} NM", delta_color="off")
    m[3].metric("Longueur ajoutée", f"{ev.extra_nm:.1f} NM")

    left, right = st.columns(2)
    fig_b = go.Figure(route_traces(scn, best))
    left.plotly_chart(map_layout(fig_b, scn, "BlackBox : seulement la solution proposée"), width='stretch')
    which = right.radio("Avion à analyser", ["Tous"] + [f"Avion {i + 1}" for i in range(scn.n)], horizontal=True)
    H = heat(name, f"{src}|{seed}", genes_all, pd_all)
    lo = H["lo"]
    xs, ys = lo[0] + H["cell"] * (np.arange(H["safe"].shape[2]) + 0.5), lo[1] + H["cell"] * (np.arange(H["safe"].shape[1]) + 0.5)
    sel = slice(None) if which == "Tous" else slice(int(which[-1]) - 1, int(which[-1]))
    layers = []
    for key, rgb in (("unsafe", "214,39,40"), ("safe", "44,160,44")):
        z = np.log1p(H[key][sel].sum(0))
        layers.append(go.Heatmap(x=xs, y=ys, z=np.where(z > 0, z, np.nan), showscale=False, hoverinfo="skip",
                                 colorscale=[[0, f"rgba({rgb},0.15)"], [1, f"rgba({rgb},0.9)"]]))
    fig_h = go.Figure(layers + route_traces(scn, best))
    right.plotly_chart(map_layout(fig_h, scn, "HeatMap : vert = modifications sûres, rouge = dangereuses"), width='stretch')
    st.caption("Chaque case colorée = endroit où au moins un candidat est passé (échelle logarithmique). "
               "Plus c'est opaque, plus l'algorithme y est passé. La solution retenue est la ligne épaisse.")

    st.subheader("Consignes données au contrôleur")
    for line in instructions(scn, best):
        st.markdown(f"- {line}")

    a, b = st.columns(2)
    gens = pd.DataFrame({"génération": gen_all, "fitness": fit_all, "sûr": dmin_all >= SEP_NM})
    per = gens.groupby("génération").agg(meilleure=("fitness", "max"), moyenne=("fitness", "mean"), part_sûre=("sûr", "mean")).reset_index()
    a.plotly_chart(px.line(per.melt("génération", ["meilleure", "moyenne"], var_name="fitness", value_name="valeur"), x="génération", y="valeur",
                           color="fitness", title="L'évolution : la population s'améliore à chaque génération"), width='stretch')
    sep_fig = go.Figure()
    for (i, j), (t, d) in separation_curves(scn, best).items():
        sep_fig.add_scatter(x=t, y=d, name=f"avion {i + 1} – avion {j + 1}", mode="lines")
    sep_fig.add_hline(y=SEP_NM, line=dict(color="red", dash="dash"), annotation_text="7 NM")
    sep_fig.update_layout(title="Distance entre avions au cours du temps (solution retenue)", xaxis_title="temps (s)", yaxis_title="NM")
    b.plotly_chart(sep_fig, width='stretch')

    st.subheader("À toi de jouer : modifie les manœuvres")
    st.caption("Pars de la solution de l'algorithme et change-la. Un contrôleur qui voit la HeatMap sait où il peut passer sans risque.")
    mine = best.copy()
    cols = st.columns(scn.n)
    for i, col in enumerate(cols):
        r = scn.routes[i]
        col.markdown(f"**Avion {i + 1}**")
        a_ = col.slider("angle (°, + = gauche)", -40, 40, int(np.clip(round(best[i][2]), -40, 40)), 5, key=f"a{i}{name}{src}{seed}")
        t1 = col.slider("début du virage (s)", 0, int(r.t[-1]), int(np.clip(best[i][0], 0, r.t[-1])), 5, key=f"t1{i}{name}{src}{seed}")
        dur = col.slider("durée avant retour (s)", 5, 450, int(np.clip(best[i][1] - best[i][0], 5, 450)), 5, key=f"d{i}{name}{src}{seed}")
        mine[i] = [t1, t1 + dur, a_]
    ev2 = evaluate(scn, mine)
    ok = ev2.dmin >= SEP_NM
    st.markdown(f"**Séparation minimale : {ev2.dmin:.1f} NM** — {'✅ sûr' if ok else '⚠️ conflit'} · durée sous 7 NM : {ev2.conflict_s:.0f} s · longueur ajoutée : {ev2.extra_nm:.1f} NM · fitness {ev2.fitness:.3f}")
    fig_m = go.Figure(layers + route_traces(scn, mine))
    st.plotly_chart(map_layout(fig_m, scn, "Ta solution sur la HeatMap"), width='stretch')
    st.caption("SHAP, LIME et le CBR (onglets 2 à 5) expliquent un modèle prédictif ; ici, l'algorithme génétique est transparent par exploration : on montre tout l'espace qu'il a parcouru.")

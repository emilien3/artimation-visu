"""Studio unique : une situation (scénario ARTIMATION réel ou avions libres), un algorithme génétique, l'analyse exacte de l'outil Vector,
et UNE fenêtre de vue qui bascule entre 2D et 3D avec les mêmes couches. Tout le reste (panneaux, réglages) est commun.
"""
import json

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from . import zenodo
from .conflict import (SEP_FT, SEP_NM, Scenario, evaluate, heat_layers, instructions, list_scenarios, scenario_from_aircraft,
                       separation_curves3d, state_at)
from .ga import LEVELS, GAConfig, run_ga
from .studio import Frame, aircraft_states, aircraft_at, build_html
from .studio_view import ViewData, figure_2d, figure_3d
from .vector import analyze3d, density_maps3d, heading_space3d

BASE = {s.name: s for s in list_scenarios()}
FREE_HORIZON_S = 900.0
MAX_FREE_AIRCRAFT = 8  # une couleur par avion dans la vue ; borne aussi le coût de l'évaluation (O(n²) paires)


@st.cache_data(show_spinner="L'algorithme génétique évolue…")
def _ga(scn_json, sep, sep_v, vertical, seed, pop, gens):
    r = run_ga(Scenario.from_dict(json.loads(scn_json)), GAConfig(pop=pop, generations=gens, seed=seed, sep=sep, sep_v=sep_v, vertical=vertical))
    return r.genes, r.generation, r.fitness, r.pair_dmin, r.best_genes


@st.cache_data(show_spinner="Lecture des solutions de l'ENAC…")
def _enac(name):
    s = BASE[name]
    genes, fit, _, gen, best = zenodo.load_run(s, int("".join(c for c in name if c.isdigit())))
    return genes, gen, fit, zenodo.pair_dmin(s, genes), best


@st.cache_data(show_spinner=False)
def _heat(scn_json, key, _genes, _pd, sep):
    return heat_layers(Scenario.from_dict(json.loads(scn_json)), _genes, _pd, sep)


@st.cache_data(show_spinner=False)
def _density(states, horizon, sep, sep_v, cols, rows, width, height, ids):
    return density_maps3d(list(states), horizon, sep, sep_v, cols=cols, rows=rows, width=width, height=height, ids=ids)


def _states_world(scn, genes, t):
    out = []
    for i, (r, g) in enumerate(zip(scn.routes, genes)):
        s = state_at(r, g, t)
        if s is not None:
            out.append((scn.ids[i], *s))
    return out


# ---------------------------------------------------------------------------------------------------------------------
def _situation():
    """Situation commune : renvoie (Scénario, nom, enac_disponible)."""
    mode = st.radio("Situation", ["Scénario réel ARTIMATION", "Situation libre (mes avions)"], horizontal=True, key="sit_mode")
    if mode.startswith("Scénario"):
        name = st.selectbox("Scénario (vols réels de 2016, ENAC)", list(BASE), index=1, key="sit_name")
        base = BASE[name]
        df = pd.DataFrame({"avion": base.ids, "FL": [360] * base.n, "taux vertical (ft/min)": [0.0] * base.n})
        ed = st.data_editor(df, key=f"lv_{name}", hide_index=True, disabled=["avion"], use_container_width=True,
                            column_config={"FL": st.column_config.NumberColumn("FL", min_value=100, max_value=450, step=10, help="Niveau de vol (×100 ft). Les vols réels recoupés sont au FL360."),
                                           "taux vertical (ft/min)": st.column_config.NumberColumn(min_value=-3000, max_value=3000, step=100)})
        scn = base.with_levels((ed["FL"].astype(float) * 100).tolist(), ed["taux vertical (ft/min)"].astype(float).tolist())
        flat = ed["FL"].nunique() == 1 and (ed["taux vertical (ft/min)"] == 0).all()
        return scn, name, zenodo.available(int("".join(c for c in name if c.isdigit()))) and flat
    seed_rows = []
    for i, r in enumerate(BASE["Scenario2"].routes):
        s = state_at(r, (0, 0, 0, 0), 0.0)
        seed_rows.append(dict(avion=f"AC{i + 1:03d}", x=round(s[0], 1), y=round(s[1], 1), cap=round(s[4]), vitesse=round(s[3]), FL=360, vz=0))
    st.caption("Avions en route directe, vitesse constante. Repère : x vers l'est, y vers le nord (NM) ; cap en degrés depuis le nord ; ajoute/supprime des lignes.")
    num = st.column_config.NumberColumn
    ed = st.data_editor(pd.DataFrame(seed_rows), key="free_rows", num_rows="dynamic", hide_index=True, use_container_width=True,
                        column_config={"x": num("x (NM)", min_value=-1000, max_value=1000), "y": num("y (NM)", min_value=-1000, max_value=1000),
                                       "cap": num("cap (°)", min_value=0, max_value=360), "vitesse": num("vitesse (kt)", min_value=100, max_value=700),
                                       "FL": num("FL", min_value=100, max_value=450, step=10),
                                       "vz": num("taux vertical (ft/min)", min_value=-3000, max_value=3000, step=100)})
    ed = ed.dropna(subset=["x", "y", "cap", "vitesse", "FL"]).reset_index(drop=True)
    if len(ed) > MAX_FREE_AIRCRAFT:
        st.warning(f"{MAX_FREE_AIRCRAFT} avions maximum : les suivants sont ignorés.")
        ed = ed.head(MAX_FREE_AIRCRAFT)
    # l'éditeur borne la saisie côté navigateur ; on re-borne côté serveur
    ed = ed.assign(x=ed["x"].clip(-1000, 1000), y=ed["y"].clip(-1000, 1000), cap=ed["cap"].clip(0, 360), vitesse=ed["vitesse"].clip(100, 700),
                   FL=ed["FL"].clip(100, 450), vz=ed["vz"].fillna(0).clip(-3000, 3000))
    ed["avion"] = [str(a)[:12] if isinstance(a, str) and a else f"AC{i + 1:03d}" for i, a in enumerate(ed["avion"])]
    if len(ed) < 2:
        st.warning("Il faut au moins deux avions.")
        st.stop()
    rows = [dict(id=r.avion, x=r.x, y=r.y, heading=r.cap, speed=r.vitesse, fl=r.FL, vz=r.vz) for r in ed.itertuples()]
    return scenario_from_aircraft(rows, FREE_HORIZON_S), "libre", False


def render():
    st.header("Studio de résolution de conflits : une situation, une fenêtre, 2D ou 3D")
    st.markdown(
        "Réimplémentation de **Hurter et al. 2022** (algorithme génétique + explications BlackBox / HeatMap) combinée à l'**outil Vector de l'ENAC** "
        "(caps sûrs et densité exacts), étendue à l'**altitude** : séparation en cylindre (NM × ft) et changements de niveau. "
        "Tout est partagé ; **seule la fenêtre de vue change** entre 2D et 3D."
    )
    scn, name, enac_ok = _situation()

    # ---- réglages communs
    c1, c2, c3, c4, c5 = st.columns(5)
    sep = float(c1.selectbox("Séparation horizontale (NM)", [3, 5, 7, 10], index=2))
    sep_v = float(c2.selectbox("Séparation verticale (ft)", [0, 500, 1000, 2000], index=2, format_func=lambda v: "ignorée" if v == 0 else str(v)))
    vertical = c3.toggle("L'AG peut changer de niveau", value=True, help="Sinon, il ne manœuvre qu'en cap (comme dans le papier).")
    seed = int(c4.number_input("Graine aléatoire", 0, 999, 0))
    horizon = float(c5.select_slider("Horizon d'analyse Vector (min)", [5, 10, 15, 30], 10))
    with st.expander("Paramètres de l'algorithme génétique"):
        pop = st.slider("Population", 20, 200, 100, 10)
        gens = st.slider("Générations", 20, 200, 100, 10)
    src = "Mon algorithme génétique"
    if enac_ok:
        src = st.radio("Source des solutions", ["Mon algorithme génétique", "Algorithme original de l'ENAC (données Zenodo)"], horizontal=True)

    scn_json = json.dumps(scn.to_dict())
    genes_all, gen_all, fit_all, pd_all, best = _enac(name) if src.startswith("Algorithme original") else _ga(scn_json, sep, sep_v, vertical, seed, pop, gens)
    best = np.hstack([best, np.zeros((len(best), 4 - best.shape[1]))]) if best.shape[1] < 4 else best
    frame = Frame.from_scenario(scn, 40.0)
    tmax = int(min(r.t[-1] for r in scn.routes))

    view_box = st.container()  # rempli en dernier : il dépend des panneaux (« Ma solution », avion analysé)
    pick = st.radio("Solution affichée", ["Celle de l'algorithme", "Ma solution (onglet « À toi de jouer »)"], horizontal=True)

    # ---- panneaux communs
    mine = best.copy()
    t_enc, t_head, t_mine, t_ga, t_sep, t_sol = st.tabs(["Rencontres", "Caps sûrs", "À toi de jouer", "Évolution de l'AG", "Séparation dans le temps", "Solution & consignes"])
    with t_mine:
        st.caption("Pars de la solution de l'algorithme et modifie-la : cap, niveau, instants. La vue (2D ou 3D) et tous les panneaux se mettent à jour.")
        cols = st.columns(scn.n)
        for i, col in enumerate(cols):
            r, k = scn.routes[i], f"{name}{seed}{src[:3]}{i}"
            col.markdown(f"**{scn.ids[i]}**")
            a_ = col.slider("angle (°, + = gauche)", -40, 40, int(np.clip(round(best[i][2]), -40, 40)), 5, key=f"m_a{k}")
            dz = col.select_slider("changement de niveau (ft)", [-2000, -1000, 0, 1000, 2000], int(np.clip(round(best[i][3] / 1000) * 1000, -2000, 2000)), key=f"m_z{k}")
            t1 = col.slider("début (s)", 0, int(r.t[-1]), int(np.clip(best[i][0], 0, r.t[-1])), 5, key=f"m_t{k}")
            dur = col.slider("durée avant retour (s)", 5, 450, int(np.clip(best[i][1] - best[i][0], 5, 450)), 5, key=f"m_d{k}")
            mine[i] = [t1, t1 + dur, a_, dz]
    shown = best if pick.startswith("Celle") else mine
    ev = evaluate(scn, shown, sep, sep_v)

    m = st.columns(5)
    m[0].metric("Candidats explorés", f"{len(genes_all):,}")
    dmin_all = np.array([p[np.isfinite(p)].min() for p in pd_all])
    m[1].metric("Part de solutions sûres", f"{(dmin_all >= sep).mean():.0%}")
    m[2].metric("Séparation min. (équivalente)", f"{ev.dmin:.1f} NM", f"seuil {sep:.0f} NM", delta_color="off")
    m[3].metric("Conflit", f"{ev.conflict_s:.0f} s")
    m[4].metric("Longueur ajoutée", f"{ev.extra_nm:.1f} NM")

    with view_box:
        v1, v2, v3 = st.columns([1, 2, 3])
        view = v1.radio("Vue", ["2D", "3D"], horizontal=True, key="studio_view")
        axis = v1.radio("Axe vertical (3D)", ["Altitude", "Temps", "Relief"], horizontal=True, key="studio_axis", disabled=view == "2D",
                        help="Altitude : niveaux de vol. Temps : (x, y, t). Relief : la densité du fond devient la hauteur.")
        bg = v2.radio("Fond de carte", ["HeatMap de l'AG (exploration)", "Densité exacte (Vector)", "Aucun"], key="studio_bg")
        which = v2.radio("Avion analysé (fond)", ["Tous"] + list(scn.ids), horizontal=True, key="studio_which")
        layers = v3.multiselect("Couches", ["Routes d'origine", "Solution", "Avions + vecteurs", "Zones de séparation"],
                                ["Routes d'origine", "Solution", "Avions + vecteurs", "Zones de séparation"], key="studio_layers")
        t = float(v3.slider("Instant (s)", 0, tmax, 0, 10, key="studio_t"))
        key = {"Routes d'origine": "routes", "Solution": "solution", "Avions + vecteurs": "aircraft", "Zones de séparation": "zones"}
        sel = slice(None) if which == "Tous" else slice(scn.ids.index(which), scn.ids.index(which) + 1)
        vd = ViewData(scn, shown, t, _states_world(scn, shown, t), sep, sep_v, frame=frame, heat_sel=sel, layers={key[x] for x in layers})
        if bg.startswith("HeatMap"):
            vd.background, vd.heat = "heat", _heat(scn_json, f"{src}|{seed}|{sep}|{sep_v}|{vertical}|{pop}|{gens}", genes_all, pd_all, sep)
        elif bg.startswith("Densité"):
            states_v = aircraft_states(scn, shown, t, frame)
            if len(states_v) >= 2:
                vd.background = "density"
                vd.density = _density(tuple(states_v), horizon, sep, sep_v, int(min(240, frame.width)), int(min(240, frame.height)),
                                      frame.width, frame.height, None if which == "Tous" else (which,))
            else:
                st.info("Moins de deux avions en vol à cet instant : pas de densité.")
        st.plotly_chart(figure_2d(vd) if view == "2D" else figure_3d(vd, axis), width="stretch")
        st.caption({"heat": "Vert : modifications sûres explorées par l'AG ; rouge : dangereuses (échelle log).",
                    "density": "Menthe : caps sûrs ; corail : conflit (calcul exact de l'outil Vector, autres avions en route directe).",
                    "none": ""}[vd.background])

    states_v = aircraft_states(scn, shown, t, frame)
    with t_enc:
        if len(states_v) < 2:
            st.info("Moins de deux avions en vol à cet instant.")
        else:
            res = analyze3d(states_v, horizon, sep, sep_v)
            if not res:
                st.success(f"Aucune rencontre dans les {horizon:.0f} prochaines minutes (avions en route directe).")
            rows = [{"paire": f"{e['a']} × {e['b']}", "approche min. (NM)": round(e["distance"], 1), "écart d'altitude (ft)": round(e["vertical_sep"]),
                     "dans": f"{int(e['t'])}:{int(e['t'] % 1 * 60):02d} min",
                     "statut": "⚠️ CONFLIT" if e["risk"] else ("✅ séparés en altitude" if e["separated_vertically"] else "croisement sans conflit")} for e in res]
            if rows:
                st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
            st.caption(f"À t = {t:.0f} s, chaque avion garde son vecteur vitesse (cap, vitesse, taux vertical). Conflit = < {sep:.0f} NM ET < {sep_v:.0f} ft.")
    with t_head:
        if len(states_v) < 2:
            st.info("Moins de deux avions en vol à cet instant.")
        else:
            who = st.selectbox("Avion", [a.id for a in states_v], key="head_who")
            hs = heading_space3d(states_v, who, horizon, sep, sep_v)
            own = next(a for a in states_v if a.id == who)
            c1, c2 = st.columns([1, 1])
            c1.metric("Caps sûrs", f"{hs['safe_degrees'] / 3.6:.1f} %")
            c1.markdown(("✅ le cap actuel est sûr." if hs["current_safe"] else "⚠️ le cap actuel mène à un conflit.") + (" Déjà dans la zone de séparation." if hs["already_inside"] else ""))
            for lo, hi in hs["safe"]:
                c1.markdown(f"- sûr de **{lo:.1f}°** à **{hi:.1f}°**")
            polar = go.Figure()
            for lo, hi in hs["safe"]:
                polar.add_trace(go.Barpolar(theta=[(lo + hi) / 2], r=[1], width=[hi - lo], marker_color="rgba(47,245,210,0.8)", showlegend=False, hoverinfo="skip"))
            for lo, hi in hs["unsafe"]:
                polar.add_trace(go.Barpolar(theta=[(lo + hi) / 2], r=[1], width=[hi - lo], marker_color="rgba(255,55,65,0.8)", showlegend=False, hoverinfo="skip"))
            polar.add_trace(go.Scatterpolar(theta=[own.heading, own.heading], r=[0, 1], mode="lines", line=dict(color="#ffcb78", width=4), name="cap actuel"))
            polar.update_layout(height=380, margin=dict(l=20, r=20, t=20, b=20), polar=dict(angularaxis=dict(rotation=90, direction="clockwise"), radialaxis=dict(visible=False)))
            c2.plotly_chart(polar, width="stretch")
    with t_ga:
        gens_df = pd.DataFrame({"génération": gen_all, "fitness": fit_all, "sûr": dmin_all >= sep})
        per = gens_df.groupby("génération").agg(meilleure=("fitness", "max"), moyenne=("fitness", "mean"), part_sûre=("sûr", "mean")).reset_index()
        st.plotly_chart(px.line(per.melt("génération", ["meilleure", "moyenne"], var_name="fitness", value_name="valeur"), x="génération", y="valeur", color="fitness",
                                title="L'évolution : la population s'améliore à chaque génération"), width="stretch")
    with t_sep:
        curves = separation_curves3d(scn, shown)
        fig = make_subplots(rows=2, cols=1, shared_xaxes=True, subplot_titles=("Distance horizontale (NM)", "Écart d'altitude (ft)"), vertical_spacing=0.12)
        for (i, j), (tt, dh, dv) in curves.items():
            lab = f"{scn.ids[i]} – {scn.ids[j]}"
            fig.add_trace(go.Scatter(x=tt, y=dh, name=lab, mode="lines", legendgroup=lab), row=1, col=1)
            fig.add_trace(go.Scatter(x=tt, y=dv, name=lab, mode="lines", legendgroup=lab, showlegend=False), row=2, col=1)
        fig.add_hline(y=sep, line=dict(color="red", dash="dash"), row=1, col=1)
        if sep_v:
            fig.add_hline(y=sep_v, line=dict(color="red", dash="dash"), row=2, col=1)
        fig.update_layout(height=520, margin=dict(l=0, r=0, t=40, b=0), xaxis2_title="temps (s)")
        st.plotly_chart(fig, width="stretch")
        st.caption("Il y a conflit quand les deux courbes d'une même paire sont sous leur seuil rouge en même temps.")
    with t_sol:
        for line in instructions(scn, shown):
            st.markdown(f"- {line}")
        st.caption("Niveaux : changement à 1 500 ft/min, retour au niveau initial à la fin de la manœuvre.")

    with st.expander("Outil d'origine de l'ENAC (2D, glisser-déposer) — pour référence"):
        try:
            st.iframe(build_html(aircraft_at(scn, float(t)), int(sep) if sep in (3, 5, 7, 10) else 5), height=1280)
            st.caption("Page de Christophe Hurter, intacte (`vendor/nextqcm/`), chargée avec la situation courante. Elle est autonome : ses modifications ne remontent pas dans le studio.")
        except ValueError as e:
            st.info(f"Situation trop grande pour l'outil d'origine : {e}")

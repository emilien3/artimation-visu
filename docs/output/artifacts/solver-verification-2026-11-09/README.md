# Vérification des deux solveurs, 9 novembre 2026

Après les corrections ci-dessous, les **104 tests passent** : 86 tests de modèle et 18 tests Firefox, sans échec ni test ignoré. Les [logs de modèle](pytest-model-after-fixes.txt) et [logs Firefox](pytest-ui-after-fixes.txt) correspondent aux sources corrigées.

## Audit de recherche

Les 240 recherches utilisent les graines 0 à 29, les deux scénarios jouets, les deux algorithmes et les deux modes d’altitude. Chaque run conserve 2 380 propositions : GA avec population 60 et 40 générations, ou recuit avec 2 379 propositions après l’état initial. Les températures du recuit vont de 0,15 à 0,00001. La séparation cible reste 7 NM et 1 000 ft.

| Cas | Solveur | Sans altitude | Altitude autorisée |
|---|---|---:|---:|
| 2 avions | Génétique | 30/30 résolus | 30/30 résolus |
| 2 avions | Recuit simulé | 30/30 résolus | 30/30 résolus |
| 4 avions | Génétique | 30/30 résolus | 30/30 résolus |
| 4 avions | Recuit simulé | 30/30 résolus | 30/30 résolus |

La réévaluation Python de **2 640 candidats**, incluant le meilleur de chaque run, donne **zéro désaccord de classification**. Les matrices de séparation par paire, durées de conflit, fitness et points des trajectoires concordent. L’écart maximal de distance est de 2,47 × 10⁻¹⁴ NM. Le contrôle direct des positions toutes les 0,25 s vérifie aussi 840 paires de meilleures trajectoires. Ce contrôle discret complète l’évaluation continue et ne la remplace pas.

Sur 16 runs, la répétition avec la même graine et la même configuration reproduit toute la trace exactement. L’audit vérifie aussi la conservation du meilleur, la monotonie du meilleur historique, les gènes admissibles, la filiation du GA, l’état courant et les refus du recuit, ainsi que le cache : le nombre d’évaluations physiques correspond au nombre de configurations de gènes distinctes.

Résultats et empreintes des sources : [search-audit.json](search-audit.json).

## Défauts corrigés

1. Le GA acceptait des limites de séparation ou une graine invalides. Les deux solveurs acceptaient un horizon nul, négatif ou non numérique. Un horizon nul pouvait renvoyer les routes initiales avec une fitness parfaite en ignorant tous les temps de vol. Les solveurs rejettent maintenant ces configurations. Un horizon positif fini et `Infinity` restent disponibles, ainsi que `sepV = 0` pour ignorer l’altitude. Un horizon fini n’évalue que cette fenêtre, pas l’ensemble du vol.
2. Avec deux températures positives extrêmement éloignées, le quotient final/initial pouvait sous-déborder à zéro. Le recuit applique alors une interpolation logarithmique qui maintient une température strictement positive. Le calcul usuel reste identique pour les réglages de démonstration.

Les assertions de régression couvrent ces cas. Les quatre meilleures solutions déjà exportées restent identiques. L’application HTML autonome a été régénérée avec les correctifs.

## Reproduire

Depuis la racine du projet :

```bash
.venv/bin/python -m pytest --ignore=tests/test_web_ui.py -q
.venv/bin/python -m pytest tests/test_web_ui.py -q
.venv/bin/python scripts/audit_searches.py > /tmp/artimation-search-audit.json
```

Node.js est nécessaire pour les invariants et l’audit. Les tests d’interface utilisent Firefox et Selenium. Un échec de démarrage du navigateur n’est pas un test réussi.

Les résultats établissent le fonctionnement sur ces scénarios et paramètres. Ils ne prouvent ni un optimum global, ni la résolution de toutes les situations, ni une supériorité générale d’un solveur. Aucun test sur matériel quantique n’a été effectué.

import json
from pathlib import Path


def main():
    import pandas as pd
    import matplotlib.pyplot as plt

    base = Path(__file__).resolve().parent / "docs/output/artifacts/exploration"
    run = json.loads(
        (base / "crossing-2-ga-0-60x40-2d-3b39c926.json").read_text()
    )

    safe = [c for c in run["candidates"] if c["label"] == "safe"]
    best = max(safe, key=lambda c: c["fitness"])
    trajectory = next(
        t for t in best["trajectories"] if t["aircraft_id"] == "AC002"
    )
    points = pd.DataFrame(trajectory["knots"]).sort_values("t_s")

    print(points)

    plt.plot(points["x_nm"], points["y_nm"], marker="o")
    plt.xlabel("x (NM)")
    plt.ylabel("y (NM)")
    plt.title("AC002")
    plt.axis("equal")
    plt.show()


if __name__ == "__main__":
    main()

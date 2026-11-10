# Artimation Visu: formulas explained

We look for trajectories that keep aircraft separated. Among safe solutions, we limit detours and the number of aircraft that maneuver. Each method searches differently.

This covers the toy demo: all aircraft at FL360, minimum horizontal separation 7 NM. GA, simulated annealing, MPC and MILP keep 360 knots. ORCA can change speed, up to 360 knots.

The coefficients are prototype choices, not aviation standards. The examples are illustrative calculations, not measured results.

## 1. Minimum separation: do the aircraft stay far enough apart?

```text
d_min = min ||p_i(t) - p_j(t)||

Safe if d_min >= 7 NM
```

- `p_i(t)`: position of aircraft i at time t.
- `||p_i(t) - p_j(t)||`: distance between two aircraft at the same instant.
- `min`: the smallest distance over the whole flight and every aircraft pair.

Two aircraft make one pair, four make six. All aircraft share one altitude, so this is horizontal distance.

Two aircraft that come within 6 NM violate the 7 NM requirement. Crossing the same point at different times is not necessarily a conflict.

## 2. Penalty: what makes a plan less attractive?

```text
P = C + 10 max(0, 7 - d_min) + 0.02 delta_L + 0.05 M
```

A lower total is better.

| Term | Meaning |
|---|---|
| `C` | Seconds in conflict, added across pairs (simultaneous conflicts count separately). |
| `10 max(0, 7 - d_min)` | How far the closest encounter falls below 7 NM. At 6 NM it is 10; at 7 NM or more it is 0. |
| `0.02 delta_L` | Extra distance flown versus the original routes, summed over aircraft, in NM. |
| `0.05 M` | Number of maneuvering aircraft times 0.05, to disturb fewer aircraft. |

`max(0, ...)` avoids a negative penalty when separation exceeds the requirement. `P` is a comparison score, not a physical quantity or a probability.

## 3. Fitness: turn the penalty into a score

```text
F = 0.5 / (1 + P) + 0.5 I(safe)

I(safe) = 1 if the plan is safe, otherwise 0
```

Higher is better. `F` scores the whole joint plan, not one aircraft.

The extra 0.5 puts every safe plan above every conflicting plan. Among safe plans, fewer detours and fewer maneuvering aircraft score higher. The implementation keeps this priority at numerical limits too.

Example: a safe plan adds 5 NM in total and reroutes one aircraft.

```text
C = 0, separation shortfall = 0, delta_L = 5, M = 1
P = 0.02 x 5 + 0.05 x 1 = 0.15
F = 0.5 / 1.15 + 0.5 = approximately 0.935
```

## 4. Genetic algorithm: search for the highest fitness

```text
Maximize F
```

It keeps a population of candidate plans. Each candidate sets a maneuver for every aircraft: when to turn, the turn angle, and when to head back to the destination.

It selects good candidates, combines their maneuvers and adds small random changes. A **parent** is an existing complete plan used to build a new one, not an aircraft.

Example: a new candidate takes aircraft 1's maneuver from one parent and aircraft 2's from another. It must be evaluated again, because the two maneuvers may conflict together.

## 5. Simulated annealing: the same score, a different search

```text
E = 1 - F

Probability of accepting a proposal = min(1, exp(-delta_E / T))
```

`E` is called energy but is just a cost: minimizing `E` maximizes fitness.

It starts from one joint plan and proposes changes to one aircraft's maneuver. `delta_E` is the proposed cost minus the current cost.

- A lower or equal cost is always accepted.
- A higher cost can still be accepted, to explore beyond the current plan.
- `T`, the temperature, sets how willing it is to accept a worse proposal. It starts high, decreases and has no physical unit.

Example: with `delta_E = 0.1` and `T = 0.1`, a worse proposal is accepted with about 37% probability. As `T` drops, that becomes less likely.

Accepted does not mean safe. The result shown is the best plan encountered, which can differ from the last accepted one.

## 6. ORCA: stay close to the desired velocity while avoiding conflicts

```text
Minimize ||v - v_desired||^2

subject to the ORCA avoidance constraints
and ||v|| <= 0.1 NM/s
```

`v` is a velocity vector (heading and speed). `v_desired` points toward the destination. The squared distance measures how far the chosen command is from the desired one.

Each aircraft picks the allowed velocity closest to its desired velocity. ORCA gives each aircraft half of the required pairwise correction, which does not necessarily mean equal turns or detours.

For crossing aircraft, the correction can change headings and reduce speeds. The limit of 0.1 NM/s equals 360 knots.

The constraints cover predicted encounters. The executed trajectories are also checked with the common separation calculation. If the constraints cannot all be met, the implementation records it.

## 7. MPC: plan ahead, execute a short interval, then replan

```text
Minimize sum over aircraft i:
    0.02 delta_L_i + 0.05 m_i + 0.01 q_i + 0.002 r_i

q_i = ||v_first_i - v_previous_i||^2 / v_nominal_i^2
```

| Symbol | Meaning |
|---|---|
| `delta_L_i` | Extra distance in aircraft i's proposed remaining route. |
| `m_i` | 1 if the aircraft maneuvers, otherwise 0. |
| `q_i` | Change from the previous velocity command to the next, scaled by nominal speed squared. Discourages abrupt changes. |
| `r_i` | Distance left to the destination at the end of the 400-second horizon. Smaller is better. |

MPC picks a plan from a finite catalogue, with separation constraints over the horizon. It plans 400 seconds ahead, executes only the next 20 seconds, updates the positions and repeats.

Example: for two aircraft approaching the crossing, it may choose a turn for aircraft 2. After 20 seconds it reassesses the encounter and picks the next command. Speed stays fixed.

Each planning step uses the catalogue MILP optimizer.

## 8. MILP: choose compatible trajectories from a catalogue

```text
Minimize sum over aircraft i and options k: c_ik x_ik

c_ik = 0.02 delta_L_ik + 0.05 m_ik

sum over k: x_ik = 1              for each aircraft i
x_ik + x_jl <= 1                  for conflicting options
x_ik is either 0 or 1
```

`x_ik` is a yes/no choice: 1 when option k is selected for aircraft i. `c_ik` is its cost, from added distance and whether the aircraft maneuvers.

The first constraint requires exactly one trajectory per aircraft. The second forbids selecting two conflicting options together.

Example: aircraft 1 and 2 each have a straight route and several turning routes. If the straight routes conflict, the optimizer cannot pick both. It can pick a compatible pair instead, such as aircraft 1 straight and aircraft 2 turning.

It selects the cheapest compatible combination. When optimality is proven, that is the best combination **within this catalogue**, not among all possible trajectories. A search stopped by its budget may return a feasible combination that is not proven cheapest.

## Reading the methods together

Sections 1 to 3 explain how we measure safety and plan quality. Sections 4 to 8 explain how each method searches. The genetic algorithm and simulated annealing use the common fitness directly. ORCA, MPC and MILP have their own objectives, and their resulting trajectories are evaluated with the same separation and route-quality measures.

The methods differ in decision rules, recording behavior and computational budget, and ORCA can also vary speed. These demos therefore do not establish a controlled performance ranking.

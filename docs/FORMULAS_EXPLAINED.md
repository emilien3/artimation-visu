# Artimation Visu: formulas explained

We look for trajectories that keep the aircraft separated. Among safe solutions, we try to limit detours and the number of aircraft that need to maneuver. Each method searches for a solution differently.

These explanations cover the toy demo: all aircraft remain at the same altitude, FL360, and the required minimum horizontal separation is 7 nautical miles (NM). GA, simulated annealing, MPC and MILP keep a speed of 360 knots. ORCA can change speed, up to 360 knots.

The coefficients below are choices made for this prototype. They are not aviation standards. The examples are illustrative calculations, rather than additional measured demo results.

## 1. Minimum separation: do the aircraft stay far enough apart?

```text
d_min = min ||p_i(t) - p_j(t)||

Safe if d_min >= 7 NM
```

- `p_i(t)` means the position of aircraft i at time t.
- `||p_i(t) - p_j(t)||` means the distance between two aircraft at the same instant.
- `min` means we retain the smallest distance over their complete trajectories and every aircraft pair.

For two aircraft, we check one pair. For four aircraft, we check six pairs. Since all aircraft are at the same altitude, this is horizontal distance.

For example, if two aircraft come as close as 6 NM, their plan violates our 7 NM requirement. Crossing the same point at different times does not necessarily create a conflict.

## 2. Penalty: what makes a plan less attractive?

```text
P = C + 10 max(0, 7 - d_min) + 0.02 delta_L + 0.05 M
```

This adds four penalties. A lower total is better.

| Term | Plain-English meaning |
|---|---|
| `C` | Seconds spent in conflict. With several aircraft, durations are added across pairs, including simultaneous conflicts. |
| `10 max(0, 7 - d_min)` | How far the closest encounter falls below 7 NM. At 6 NM, this term is 10. At 7 NM or above, it is zero. |
| `0.02 delta_L` | Extra distance traveled compared with the original routes, summed over the aircraft, in NM. |
| `0.05 M` | Number of aircraft that maneuver, multiplied by 0.05. This encourages solutions that disturb fewer aircraft. |

`max(0, ...)` prevents a negative penalty when separation exceeds the requirement. The weighted sum is a score used to compare plans; it is not a physical quantity or a probability.

## 3. Fitness: turn the penalty into a score

```text
F = 0.5 / (1 + P) + 0.5 I(safe)

I(safe) = 1 if the plan is safe, otherwise 0
```

Higher fitness means a better plan. The score evaluates the complete joint plan for all aircraft, rather than one aircraft in isolation.

The extra 0.5 for safety ensures that every safe plan scores above every conflicting plan. Among safe plans, fewer detours and fewer maneuvering aircraft increase the score. The implementation preserves this priority at numerical limits too.

For example, suppose a safe plan adds 5 NM in total and changes the route of one aircraft:

```text
C = 0, separation shortfall = 0, delta_L = 5, M = 1
P = 0.02 x 5 + 0.05 x 1 = 0.15
F = 0.5 / 1.15 + 0.5 = approximately 0.935
```

## 4. Genetic algorithm: search for the highest fitness

```text
Maximize F
```

The algorithm maintains a population of candidate plans. Each candidate specifies maneuvers for all aircraft: when to turn, the turn angle, and when to head back toward the destination.

It selects promising candidates, combines their aircraft maneuvers, and introduces small random changes. A **parent** is simply an existing complete candidate plan used to create another candidate. It is not an aircraft.

For our two-aircraft case, a new candidate could take aircraft 1's maneuver from one parent and aircraft 2's maneuver from another. The new combination must be evaluated again because those maneuvers may conflict when used together.

## 5. Simulated annealing: the same score, a different search

```text
E = 1 - F

Probability of accepting a proposal = min(1, exp(-delta_E / T))
```

`E` is called energy, but here it is just a cost. Minimizing `E` is equivalent to maximizing fitness.

The algorithm starts from one joint plan and proposes changes to an aircraft's maneuver. `delta_E` is the proposed cost minus the current cost.

- A lower or equal cost is always accepted.
- A higher cost can still be accepted, to explore beyond the current plan.
- `T`, the temperature, controls this willingness to accept a worse proposal. It starts high and decreases. It has no physical unit here.

For example, a worse proposal with `delta_E = 0.1` has about a 37% acceptance probability when `T = 0.1`. As temperature decreases, accepting that same deterioration becomes less likely.

Accepted does not mean safe. The displayed result is the best plan encountered, which can differ from the last accepted plan.

## 6. ORCA: stay close to the desired velocity while avoiding conflicts

```text
Minimize ||v - v_desired||^2

subject to the ORCA avoidance constraints
and ||v|| <= 0.1 NM/s
```

`v` is a velocity vector: it describes both heading and speed. `v_desired` points toward the destination. The squared distance between these vectors measures how much the chosen command differs from the desired one.

Each aircraft chooses the closest allowed velocity to its desired velocity. ORCA assigns each aircraft half of the required pairwise relative-velocity correction; this does not necessarily mean equal turns or equal detours.

For our crossing aircraft, the correction can change their headings and reduce their speeds. The speed limit of 0.1 NM/s equals 360 knots.

The constraints concern predicted encounters. The final executed trajectories are also checked with the common separation calculation. If the constraints cannot all be satisfied, the implementation records that explicitly.

## 7. MPC: plan ahead, execute a short interval, then replan

```text
Minimize sum over aircraft i:
    0.02 delta_L_i + 0.05 m_i + 0.01 q_i + 0.002 r_i

q_i = ||v_first_i - v_previous_i||^2 / v_nominal_i^2
```

| Symbol | Meaning |
|---|---|
| `delta_L_i` | Extra distance in aircraft i's proposed remaining route. |
| `m_i` | 1 if that aircraft maneuvers, otherwise 0. |
| `q_i` | Change between its next velocity command and the previous one, scaled by nominal speed squared. This discourages abrupt command changes. |
| `r_i` | Distance still remaining to its destination at the end of the 400-second prediction horizon. Smaller means better progress. |

Our MPC selects a plan from a finite catalogue, with separation constraints over the prediction horizon. It plans 400 seconds ahead but executes only the next 20 seconds. It then updates the aircraft positions and repeats the process.

For two aircraft approaching the crossing, it might select a turn for aircraft 2. After 20 seconds, it reassesses the remaining encounter and chooses the next command. Speed stays fixed in this implementation.

MPC describes this repeated planning process. Our implementation uses the catalogue MILP optimizer inside each planning step.

## 8. MILP: choose compatible trajectories from a catalogue

```text
Minimize sum over aircraft i and options k: c_ik x_ik

c_ik = 0.02 delta_L_ik + 0.05 m_ik

sum over k: x_ik = 1              for each aircraft i
x_ik + x_jl <= 1                  for conflicting options
x_ik is either 0 or 1
```

`x_ik` is a yes/no choice: it equals 1 when trajectory option k is selected for aircraft i. `c_ik` is that option's cost, based on added distance and whether the aircraft maneuvers.

The first constraint requires exactly one trajectory per aircraft. The second prevents two conflicting options from being selected together.

For example, suppose aircraft 1 and aircraft 2 each have a straight route and several turning routes. The optimizer cannot choose both original straight routes if they conflict. It can instead select a compatible combination, such as aircraft 1 continuing straight and aircraft 2 turning.

The objective selects the cheapest compatible combination. When the search proves optimality, that means the best combination **within this catalogue**, not the best of every imaginable trajectory. A search stopped by its budget may return a feasible combination without proving it is the cheapest.

## Reading the methods together

Sections 1 to 3 explain how we measure safety and plan quality. Sections 4 to 8 explain how each method searches. The genetic algorithm and simulated annealing directly use the common fitness. ORCA, MPC and MILP have their own objectives, and we then evaluate their resulting trajectories using the same separation and route-quality measurements.

The methods have different decision rules, recording behavior and computational budgets. ORCA also has more freedom because it can vary speed. These demonstrations therefore do not establish a controlled performance ranking.

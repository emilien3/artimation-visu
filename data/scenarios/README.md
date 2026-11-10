ARTIMATION conflict detection/resolution scenarios, adapted by ENAC from 2016 flight records to create the required conflicts.

Source: https://zenodo.org/records/7437564 (Hurter, Degas, Durand), CC BY 4.0.

Each line contains one aircraft route: a Python list of ((x, y) in NM, time). Altitude is not encoded in these trajectory files; the application initializes routes at FL360.

`enac-starts.json` is derived from the first point of the default `traj` exports in the [ENAC solution dataset](https://zenodo.org/records/7437654), by Nicolas Durand, Augustin Degas and Christophe Hurter, CC BY 4.0. It contains one snapshot position per aircraft, in the same order as the scenario files. Archive MD5: `e0997d1839f8c9ce80dc7099be32bbd7`. These are slightly later than the scenario-file start positions. They enable reproducible reconstruction without requiring the full optional solution download. See [the reconstruction audit](../../docs/ENAC_RECONSTRUCTION.md).

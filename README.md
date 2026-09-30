# Lemström Case 1 viewer

Interactive comparison of four DEM simulations with the Lemström Case 1 experiment.

## Particle export

Particle mesh owners and frame rows use ascending **stable particle ID**, never checkpoint array order. MPI rank migration changes checkpoint ordering; using raw array slots pairs poses with unrelated shapes and creates false gaps.

Export the shared mesh and each frame from existing v10/v11 checkpoints:

```sh
uv run tools/export_particles.py mesh CHECKPOINT data/particles.bin.gz
uv run tools/export_particles.py frame CHECKPOINT data/run2/10.bin.gz
uv run --with numpy tools/test_export_particles.py
```

The exporter reads IDs from the checkpoint reference block and sorts body geometry and state consistently. It rejects incomplete/duplicate IDs, unsupported layouts, and invalid quaternion norms. All 184 frames and the static mesh have been regenerated; structure geometry, loads, and video are unchanged. No simulation reruns are needed.

Serve this local checkout with `uv run --no-project python -m http.server 8877 --bind 127.0.0.1`.

## Experimental-data attribution

The experimental load data and video are from:

> Lemström, I., Polojärvi, A., Puolakka, O., & Tuhkuri, J. (2022). Load, pressure, rubble pile geometry and video data from model-scale tests on shallow water ice-structure interaction. *Data in Brief, 45*, 108580. https://doi.org/10.1016/j.dib.2022.108580

Original dataset: https://doi.org/10.5281/zenodo.6524282

The experimental material is distributed under the Creative Commons Attribution 4.0 license: https://creativecommons.org/licenses/by/4.0/

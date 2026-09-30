# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Export v10/v11 DEM checkpoints in stable particle-ID order.

Run with uv run tools/export_particles.py mesh|frame CHECKPOINT OUTPUT.
Only the little-endian checkpoint layouts used by this viewer are supported.
"""
import argparse
import gzip
import io
import struct
from pathlib import Path

import numpy as np


def read_checkpoint(path):
    with Path(path).open('rb') as f:
        header = f.read(116)
        if len(header) != 116:
            raise ValueError('Truncated checkpoint header')
        h = struct.unpack('<8s27i', header)
        if h[0] != b'DEMCHK1\0' or h[1] not in (10, 11):
            raise ValueError('Expected a v10/v11 DEM checkpoint')
        if h[14:16] != (4, 8) or h[5] != 1 or h[7] != 128:
            raise ValueError('Unsupported checkpoint ABI')
        maxv, maxf, maxe = h[20:23]
        if h[6] != maxv * 24 or h[4] != 2 + (maxf + 1) + 2 * maxe + 1 + 4 * maxe:
            raise ValueError('Unsupported shape/body-vertex layout')
        f.seek(h[2] + h[3], 1)

        def block(size):
            raw = f.read(4)
            if len(raw) != 4:
                raise ValueError('Missing block count')
            count, = struct.unpack('<i', raw)
            if count < 0:
                raise ValueError('Negative block count')
            data = f.read(count * size)
            if len(data) != count * size:
                raise ValueError('Truncated checkpoint block')
            return count, data

        ns, shapes = block(h[4])
        n, shape_ids = block(h[5])
        nv, body = block(h[6])
        nt, states = block(h[7])
        nl, _ = block(h[8])
        nr, refs = block(h[9])
        if len({n, nv, nt, nl, nr}) != 1 or not n:
            raise ValueError('Particle block counts differ or are empty')
        ids = np.ndarray((n,), '<i4', refs, strides=(h[9],)).copy()
        order = np.argsort(ids)
        # These runs keep the original complete ID set. Reject missing,
        # duplicated or newly introduced particles instead of silently pairing them.
        if not np.array_equal(ids[order], np.arange(n)):
            raise ValueError('Expected unique, complete particle IDs 0..count-1')
        shape_ids = np.frombuffer(shape_ids, 'u1')[order]
        if np.any(shape_ids >= ns):
            raise ValueError('Invalid shape ID')
        return (
            np.frombuffer(shapes, 'u1').reshape(ns, h[4]),
            shape_ids,
            np.frombuffer(body, '<f8').reshape(n, maxv, 3)[order],
            np.frombuffer(states, '<f8').reshape(n, 16)[order],
            maxf,
        )


def mesh_bytes(snapshot):
    shapes, shape_ids, body, _, maxf = snapshot
    vertices, owners, indices = [], [], []
    base = 0
    for slot, sid in enumerate(shape_ids):
        shape = shapes[sid]
        nv, nf = map(int, shape[:2])
        if not 0 < nv <= body.shape[1] or not 0 < nf <= maxf:
            raise ValueError('Invalid shape dimensions')
        offsets = shape[2:3 + maxf]
        face_vertices = shape[3 + maxf:]
        vertices.append(body[slot, :nv].astype('<f4'))
        owners.append(np.full(nv, slot, dtype='<u4'))
        for face in range(nf):
            a, z = map(int, offsets[face:face + 2])
            loop = face_vertices[a:z].astype(np.int64)
            if len(loop) < 3 or np.any(loop >= nv):
                raise ValueError('Invalid face loop')
            for k in range(1, len(loop) - 1):
                indices.extend((base + int(loop[0]), base + int(loop[k]), base + int(loop[k + 1])))
        base += nv
    return (struct.pack('<4sIII', b'DMM1', len(shape_ids), base, len(indices))
            + np.concatenate(vertices).tobytes() + np.concatenate(owners).tobytes()
            + np.asarray(indices, dtype='<u4').tobytes())


def frame_bytes(snapshot):
    states = snapshot[3]
    positions, quaternions = states[:, :3], states[:, [10, 11, 12, 9]]
    if not np.all(np.isfinite(positions)) or not np.all(np.isfinite(quaternions)):
        raise ValueError('Non-finite particle state')
    if not np.allclose(np.linalg.norm(quaternions, axis=1), 1, atol=1e-4):
        raise ValueError('Invalid quaternion norm')
    bounds = np.r_[positions.min(axis=0), positions.max(axis=0)].astype('<f4')
    span = bounds[3:].astype(float) - bounds[:3]
    scaled = np.divide(positions - bounds[:3], span, out=np.zeros_like(positions), where=span > 0)
    packed_positions = np.clip(np.floor(scaled * 65535 + 0.5), 0, 65535).astype('<u2')
    packed_quaternions = np.clip(np.rint(quaternions * 32767), -32767, 32767).astype('<i2')
    return (struct.pack('<4sIII', b'DMQ1', len(states), 0, 0) + bounds.tobytes()
            + packed_positions.tobytes() + packed_quaternions.tobytes())


def export(mode, checkpoint, output):
    snapshot = read_checkpoint(checkpoint)
    data = mesh_bytes(snapshot) if mode == 'mesh' else frame_bytes(snapshot)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, mode='wb', compresslevel=6, mtime=0) as stream:
        stream.write(data)
    output.write_bytes(compressed.getvalue())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('mesh', 'frame'))
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    export(args.mode, args.checkpoint, args.output)

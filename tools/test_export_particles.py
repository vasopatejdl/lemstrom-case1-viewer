"""Regression: checkpoint/rank ordering must not affect exported geometry or poses."""
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
from export_particles import read_checkpoint, mesh_bytes, frame_bytes


def checkpoint(path, order):
    # Minimal v10 ABI fixture: tetrahedron, three distinct particles.
    shape = bytes([4, 4, 0, 3, 6, 9, 12,
                   0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3,
                   6] + [0] * 24)
    header = struct.pack('<8s27i', b'DEMCHK1\0', 10, 0, 0, len(shape),
                         1, 96, 128, 48, 8, 281, 0, 0, 0, 4, 8,
                         1, 1, 1, 1, 4, 4, 6, 3, 0, 0, 0, 0)
    body = np.array([[[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]] * 3, dtype='<f8')
    body *= np.arange(1, 4)[:, None, None]
    states = np.zeros((3, 16), dtype='<f8')
    states[:, :3] = [[10, 1, 2], [20, 3, 4], [30, 5, 6]]
    states[:, 9:13] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
    refs = np.array([[0, 0], [1, 0], [2, 0]], dtype='<i4')
    arrays = [shape, bytes(3), body[order].tobytes(), states[order].tobytes(),
              bytes(3 * 48), refs[order].tobytes()]
    path.write_bytes(header + b''.join(struct.pack('<i', n) + data
                                      for n, data in zip([1, 3, 3, 3, 3, 3], arrays)))


class OrderingTest(unittest.TestCase):
    def test_rank_reordering_preserves_mesh_and_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / 'a', Path(directory) / 'b'
            checkpoint(a, [0, 1, 2]); checkpoint(b, [2, 0, 1])
            sa, sb = read_checkpoint(a), read_checkpoint(b)
            self.assertEqual(mesh_bytes(sa), mesh_bytes(sb))
            self.assertEqual(frame_bytes(sa), frame_bytes(sb))
            self.assertEqual(mesh_bytes(sa)[:4], b'DMM1')
            self.assertEqual(frame_bytes(sa)[:4], b'DMQ1')

    def test_duplicate_ids_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'duplicate'
            checkpoint(p, [0, 0, 2])
            with self.assertRaisesRegex(ValueError, 'particle IDs'):
                read_checkpoint(p)


if __name__ == '__main__':
    unittest.main()

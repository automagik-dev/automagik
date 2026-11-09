//! XXH64 (seed 0), streaming: what a zstd frame's content checksum is made of (RFC 8878,
//! section 3.1.1: the low 32 bits of XXH64 over the decoded content). Written out here so that
//! checking dsh-tui's frames adds no dependency; the vectors in the tests are the zstd CLI's.

const P1: u64 = 0x9E37_79B1_85EB_CA87;
const P2: u64 = 0xC2B2_AE3D_27D4_EB4F;
const P3: u64 = 0x1656_67B1_9E37_79F9;
const P4: u64 = 0x85EB_CA77_C2B2_AE63;
const P5: u64 = 0x27D4_EB2F_1656_67C5;

pub struct Xxh64 {
    v: [u64; 4],
    buf: [u8; 32],
    len: usize,
    total: u64,
}

fn round(acc: u64, input: u64) -> u64 {
    acc.wrapping_add(input.wrapping_mul(P2))
        .rotate_left(31)
        .wrapping_mul(P1)
}

fn merge(acc: u64, v: u64) -> u64 {
    (acc ^ round(0, v)).wrapping_mul(P1).wrapping_add(P4)
}

fn u64_at(b: &[u8]) -> u64 {
    u64::from_le_bytes(b[..8].try_into().unwrap_or([0; 8]))
}

impl Default for Xxh64 {
    fn default() -> Xxh64 {
        Xxh64 {
            v: [P1.wrapping_add(P2), P2, 0, 0u64.wrapping_sub(P1)],
            buf: [0; 32],
            len: 0,
            total: 0,
        }
    }
}

impl Xxh64 {
    fn stripe(&mut self, b: &[u8]) {
        for (i, v) in self.v.iter_mut().enumerate() {
            *v = round(*v, u64_at(&b[i * 8..]));
        }
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.total += data.len() as u64;
        if self.len > 0 {
            let take = (32 - self.len).min(data.len());
            self.buf[self.len..self.len + take].copy_from_slice(&data[..take]);
            self.len += take;
            data = &data[take..];
            if self.len < 32 {
                return;
            }
            let buf = self.buf;
            self.stripe(&buf);
            self.len = 0;
        }
        while data.len() >= 32 {
            self.stripe(&data[..32]);
            data = &data[32..];
        }
        self.buf[..data.len()].copy_from_slice(data);
        self.len = data.len();
    }

    pub fn finish(&self) -> u64 {
        let [v1, v2, v3, v4] = self.v;
        let mut h = if self.total >= 32 {
            let h = v1
                .rotate_left(1)
                .wrapping_add(v2.rotate_left(7))
                .wrapping_add(v3.rotate_left(12))
                .wrapping_add(v4.rotate_left(18));
            [v1, v2, v3, v4].into_iter().fold(h, merge)
        } else {
            P5
        };
        h = h.wrapping_add(self.total);
        let mut rest = &self.buf[..self.len];
        while rest.len() >= 8 {
            h ^= round(0, u64_at(rest));
            h = h.rotate_left(27).wrapping_mul(P1).wrapping_add(P4);
            rest = &rest[8..];
        }
        if rest.len() >= 4 {
            let k = u64::from(u32::from_le_bytes(rest[..4].try_into().unwrap_or([0; 4])));
            h ^= k.wrapping_mul(P1);
            h = h.rotate_left(23).wrapping_mul(P2).wrapping_add(P3);
            rest = &rest[4..];
        }
        for b in rest {
            h ^= u64::from(*b).wrapping_mul(P5);
            h = h.rotate_left(11).wrapping_mul(P1);
        }
        h ^= h >> 33;
        h = h.wrapping_mul(P2);
        h ^= h >> 29;
        h = h.wrapping_mul(P3);
        h ^ (h >> 32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn xxh64(chunks: &[&[u8]]) -> u64 {
        let mut x = Xxh64::default();
        for c in chunks {
            x.update(c);
        }
        x.finish()
    }

    /// The low 32 bits are what `zstd` writes as a frame's checksum.
    #[test]
    fn known_vectors_in_any_chunking() {
        assert_eq!(xxh64(&[]), 0xEF46_DB37_51D8_E999);
        assert_eq!(xxh64(&[b"abc"]), 0x44BC_2CF5_AD77_0999);
        let fox = b"The quick brown fox jumps over the lazy dog";
        assert_eq!(xxh64(&[fox]) as u32, 0x1FDA_71BC);
        let (a, b) = fox.split_at(7);
        assert_eq!(xxh64(&[a, b]), xxh64(&[fox]));
        let x100 = [b'x'; 100];
        assert_eq!(xxh64(&[&x100]) as u32, 0x88A3_C094);
        assert_eq!(
            xxh64(&[&x100[..31], &x100[31..64], &x100[64..]]),
            xxh64(&[&x100])
        );
    }

    /// Every length from 4 to 31 bytes: inputs under one 32-byte stripe go through the tail
    /// alone (the 8-, 4- and 1-byte steps in every mix). The expected values are the zstd CLI's
    /// content checksums for these inputs (`zstd --check`: XXH64's low 32 bits), taken once with
    /// a script that is not kept. The input is byte `i` = (37 i + 11) mod 256.
    #[test]
    fn every_tail_length_matches_the_zstd_cli() {
        const VECTORS: [(usize, u32); 28] = [
            (4, 0xF1AE4D95),
            (5, 0x1F68F273),
            (6, 0x1449561E),
            (7, 0x0496C04E),
            (8, 0x21F3E21A),
            (9, 0x75257B66),
            (10, 0x474903FF),
            (11, 0x443A2D5A),
            (12, 0x66039E64),
            (13, 0x7BB13C7A),
            (14, 0x0A97D46F),
            (15, 0xB00E8D29),
            (16, 0x99721174),
            (17, 0x2B272AD6),
            (18, 0x75A43C96),
            (19, 0x26258CEA),
            (20, 0x8D2D838D),
            (21, 0xD78F8827),
            (22, 0xDEFC3911),
            (23, 0x5D7C06F8),
            (24, 0x57E1565E),
            (25, 0x854B47A5),
            (26, 0x9DA33210),
            (27, 0xE95CBBBC),
            (28, 0x1446F7E5),
            (29, 0x1A84DBDB),
            (30, 0x1F080751),
            (31, 0xE519A4AE),
        ];
        let data: Vec<u8> = (0..31u32).map(|i| ((i * 37 + 11) % 256) as u8).collect();
        for (n, want) in VECTORS {
            assert_eq!(xxh64(&[&data[..n]]) as u32, want, "length {n}");
            let (a, b) = data[..n].split_at(n / 2);
            assert_eq!(xxh64(&[a, b]) as u32, want, "length {n} in two chunks");
        }
    }
}

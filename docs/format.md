# Film format

A film is a folder holding a `manifest.json` and its parts, `00.bin`,
`01.bin`, and so on. The parts together are one H.264 stream, frame after
frame, in AVCC form: each NAL unit follows its 4-byte big-endian length.
There are no start codes and no container.

## manifest.json

```json
{
  "format": "scrollfilm",
  "version": 1,
  "codec": "avc1.640028",
  "description": "AWQAKP/hABtnZAAorNlA…",
  "width": 864,
  "height": 1536,
  "parts": [0, 312, 650],
  "sizes": [48211, 9120, 8875],
  "keys": [0, 16, 32],
  "times": [0, 0.0004, 0.0009],
  "v": "85cd465ac5"
}
```

| Field | Meaning |
|---|---|
| `codec` | The WebCodecs codec string. |
| `description` | The `avcC` decoder configuration record, in base64. |
| `width`, `height` | The frame size in pixels. |
| `sizes` | Each frame's size in bytes, in order. The number of entries is the number of frames. |
| `parts` | The first frame of each part. Part `p` holds frames `parts[p]` up to `parts[p + 1] - 1`, back to back. |
| `keys` | The keyframes, rising. The first frame must be one. |
| `times` | Optional. Each frame's place in the scroll, from 0 to 1, rising. Without it, frames are evenly spaced. |
| `v` | Optional. A version of the parts' contents. The player adds it to part URLs as `?v=`, so a re-encoded film never comes from a stale cache. |

The stream must have no B-frames: the player decodes frames in the order they
show and gives each frame's index as its timestamp.

## Using your own manifest

The player only needs these fields, so a site that already writes its own
manifest can hand them over directly:

```js
film.load({ base: '/film/phone/', video: myManifest.phone, times: myTimes, version: myManifest.v });
```

## Hosting

Serve the parts with long-lived caching. Each URL carries `?v=` from the
manifest, so a new encode gets new URLs. Serve `manifest.json` itself with
revalidation (`no-cache`). For example, with Cloudflare Pages' `_headers`:

```
/film/*
  Cache-Control: public, max-age=2592000
/film/manifest.json
  Cache-Control: no-cache
```

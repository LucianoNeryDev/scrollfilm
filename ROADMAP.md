# Roadmap

What is planned, roughly in order. Nothing here has a date.

- **Test on iPhones.** Safari's WebCodecs is tested only through WebKit on
  Linux so far.
- **Going back without WebCodecs.** Firefox for Android seeks about 8 times a
  second, so the film steps going back. A second, reversed encode of the film
  would let the video play backwards too, at twice the download.
- **Adaptive cruise speed.** Measure the decoder's throughput on the device
  and set the film's top speed from it, instead of a phone and a computer
  default.
- **Start before everything is downloaded.** Open as soon as the parts around
  the start are in, and keep the film from gliding into parts still on their
  way.
- **Smaller films.** Optional AV1 or HEVC where the device decodes them in
  hardware, with H.264 as the fallback.

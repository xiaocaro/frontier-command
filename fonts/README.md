# Chinese typography

`AlibabaPuHuiTi-3-55-Regular.ttf` and `AlibabaPuHuiTi-3-65-Medium.ttf` are the
original, unchanged Alibaba PuHuiTi files supplied for this project. Both
bundled optical faces now derive from **Medium**. English and numbers use the
original LCARS 26 Antonio Regular/Bold assets, including Bold for titles.

`AlibabaPuHuiTi-LCARS-Regular.ttf` pairs Medium outlines with Antonio Regular
at CSS weight 400. `AlibabaPuHuiTi-LCARS-Bold.ttf` pairs calibrated Medium
outlines with Antonio Bold at CSS weight 700. These are two explicit static
faces; browser font synthesis is disabled globally. The former single Regular
file declared as a 400–700 range silently left Chinese titles much thinner
than the English Bold face.

Both faces normalize Chinese cap height and alphabetic baseline. Bold uses
Skia PathOps outline stroke/union with independently calibrated x/y growth,
matching the vertical and horizontal reference strokes of Antonio H to
PuHuiTi 日. Calibration accounts for subsequent vertical normalization.
Advances and kerning remain unchanged; side bearings follow grown outlines to
preserve glyph origins. Original licensing/copyright metadata is preserved;
obsolete hints and signatures are removed from the derivatives only.

To regenerate the checked-in assets:

```sh
python -m pip install -r fonts/requirements.txt
python scripts/normalize-lcars-font.py
```

The script validates the saved integer-rounded stroke geometry within 10% of
each reference and writes `optical-metrics.json`. FontTools and Skia PathOps
are development asset-authoring dependencies; `npm build` and Electron need
neither Python nor those packages. Both fonts load locally offline.

Original file SHA-256:

- Regular: `BE33BC8D45CED30FA5C542F6F056565BAF85003D4E079522110D76016F8A04E2`
- Medium: `D92B378A2D08AC1E5C2B87D03B9939FDFAE93D3C336B6A13AC4E00CE44F6DB9E`

Electron verification checks the exact Regular/Bold platform font names,
painted glyph bounds, antialiased reference stroke coverage, and screenshots
at 125%, 150% and 200% display scaling. It also checks all shared title bars
for uniform butterscotch ends with zero border widths. Equal CSS font size or
glyph height alone does not verify mixed-script weight.

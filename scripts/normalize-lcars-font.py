"""Author two optical CJK faces from supplied PuHuiTi Medium.

Install fonts/requirements.txt to regenerate. Neither npm build nor Electron
needs Python. Antonio and both original Alibaba files remain unchanged.
"""

import json
from pathlib import Path
from statistics import mean, median

import pathops
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts/AlibabaPuHuiTi-3-65-Medium.ttf"
SAMPLES = "舰队指令"


def crossings(font, char, vertical):
    """Measure straight reference stems through outlines, in font units."""
    name = font.getBestCmap()[ord(char)]
    glyph = font["glyf"][name]
    glyph_set = font.getGlyphSet()
    if vertical:
        lo, hi = glyph.xMin, glyph.xMax
        point = lambda v: (v, glyph.yMin + (glyph.yMax - glyph.yMin) * 0.25)
    else:
        lo, hi = glyph.yMin, glyph.yMax
        point = lambda v: ((glyph.xMin + glyph.xMax) / 2, v)
    step = (hi - lo) / 4096
    spans = []
    start = None
    for i in range(4097):
        value = lo + i * step
        pen = PointInsidePen(glyph_set, point(value))
        glyph_set[name].draw(pen)
        inside = pen.getResult()
        if inside and start is None:
            start = value
        if start is not None and (not inside or i == 4096):
            spans.append(value - start)
            start = None
    return median(spans)


def paths(font):
    # Decompose before transforming, so composites are never moved twice.
    glyph_set = font.getGlyphSet()
    result = {}
    for name in font.getGlyphOrder():
        recording = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(recording)
        path = pathops.Path()
        recording.replay(path.getPen())
        result[name] = path
    return result


def embolden(path, radius_x, radius_y):
    if not radius_x or not radius_y or not len(path):
        return path
    # A circular stroke in this space produces independent x/y growth. Union
    # with the original preserves filled glyph cores and interior counters.
    ratio = radius_y / radius_x
    core = path.transform(ratio, 0, 0, 1, 0, 0)
    stroke = pathops.Path(core)
    stroke.stroke(2 * radius_y, pathops.LineCap.BUTT_CAP, pathops.LineJoin.ROUND_JOIN, 2)
    stroke.convertConicsToQuads(0.25)
    grown = pathops.op(core, stroke, pathops.PathOp.UNION)
    grown.convertConicsToQuads(0.25)
    return grown.transform(1 / ratio, 0, 0, 1, 0, 0)


def bounds(font, outlines, radius_x=0, radius_y=0):
    cmap = font.getBestCmap()
    samples = [embolden(outlines[cmap[ord(c)]], radius_x, radius_y).bounds for c in SAMPLES]
    return mean(b[1] for b in samples), mean(b[3] for b in samples)


def author(style, weight):
    source = TTFont(SOURCE, recalcTimestamp=False)
    reference = TTFont(ROOT / f"src/assets/lcars-26/assets/Antonio-{style}.woff")
    units = source["head"].unitsPerEm
    ratio = units / reference["head"].unitsPerEm
    cap = reference["OS/2"].sCapHeight * ratio
    source_vertical = crossings(source, "日", True)
    source_horizontal = crossings(source, "日", False)
    target_vertical = crossings(reference, "H", True) * ratio
    target_horizontal = crossings(reference, "H", False) * ratio
    outlines = paths(source)
    radius_x = radius_y = 0.0
    if weight == 700:
        radius_x = (target_vertical - source_vertical) / 2
        # Normalizing height thins horizontal strokes. Solve against the final
        # cap box, rather than guessing weight or using Chromium synthetic bold.
        lo, hi = 0.0, units * 0.08
        for _ in range(24):
            radius_y = (lo + hi) / 2
            bottom, top = bounds(source, outlines, radius_x, radius_y)
            thickness = (source_horizontal + 2 * radius_y) * cap / (top - bottom)
            if thickness < target_horizontal:
                lo = radius_y
            else:
                hi = radius_y
    bottom, top = bounds(source, outlines, radius_x, radius_y)
    scale = cap / (top - bottom)
    offset = -bottom * scale
    result = {}
    for i, name in enumerate(source.getGlyphOrder()):
        pen = TTGlyphPen(None)
        target = Cu2QuPen(pen, max_err=0.5, reverse_direction=False)
        grown = embolden(outlines[name], radius_x, radius_y)
        grown.draw(TransformPen(target, (1, 0, 0, scale, 0, offset)))
        glyph = pen.glyph()
        glyph.recalcBounds(source["glyf"])
        result[name] = glyph
        # Advances/kerning stay unchanged; LSB must follow the grown outline
        # so TrueType phantom points do not translate the whole glyph.
        advance, lsb = source["hmtx"][name]
        source["hmtx"][name] = (advance, glyph.xMin if glyph.numberOfContours else lsb)
        if i and i % 5000 == 0:
            print(f"{style}: {i}/{len(outlines)} glyphs", flush=True)
    source["glyf"].glyphs = result
    for table in ("prep", "fpgm", "cvt ", "LTSH", "VDMX", "hdmx", "DSIG"):
        if table in source:
            del source[table]
    for field in ("ascent", "descent", "lineGap"):
        setattr(source["hhea"], field, round(getattr(reference["hhea"], field) * ratio))
    for field in ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "sCapHeight"):
        setattr(source["OS/2"], field, round(getattr(reference["OS/2"], field) * ratio))
    source["OS/2"].usWeightClass = weight
    source["OS/2"].fsSelection &= ~((1 << 5) | (1 << 6))
    source["OS/2"].fsSelection |= (1 << 7) | (1 << (5 if weight == 700 else 6))
    source["head"].macStyle = (source["head"].macStyle & ~1) | (1 if weight == 700 else 0)
    for record in source["name"].names:
        replacement = {
            1: "Alibaba PuHuiTi LCARS",
            2: style,
            3: f"Alibaba PuHuiTi LCARS {style} 2.0",
            4: f"Alibaba PuHuiTi LCARS {style}",
            6: f"AlibabaPuHuiTiLCARS-{style}",
            16: "Alibaba PuHuiTi LCARS",
            17: style,
        }.get(record.nameID)
        if replacement:
            record.string = replacement.encode(record.getEncoding())
    output = ROOT / f"fonts/AlibabaPuHuiTi-LCARS-{style}.ttf"
    source.save(output)
    # Inspect the saved integer-rounded outlines, not just construction math.
    saved = TTFont(output)
    actual_vertical = crossings(saved, "日", True)
    actual_horizontal = crossings(saved, "日", False)
    metrics = {
        "style": style,
        "weight": weight,
        "source": SOURCE.name,
        "verticalScale": scale,
        "baselineOffset": offset,
        "growthRadius": {"x": radius_x, "y": radius_y},
        "strokes": {
            "vertical": {"target": target_vertical, "actual": actual_vertical},
            "horizontal": {"target": target_horizontal, "actual": actual_horizontal},
        },
    }
    for stem in metrics["strokes"].values():
        if abs(stem["actual"] / stem["target"] - 1) > 0.10:
            raise ValueError(f"{style}: stroke calibration failed: {stem}")
    print(json.dumps(metrics), flush=True)
    return metrics


if __name__ == "__main__":
    metrics = [author("Regular", 400), author("Bold", 700)]
    (ROOT / "fonts/optical-metrics.json").write_text(
        json.dumps(metrics, indent=2) + "\n", encoding="utf-8"
    )

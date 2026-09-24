"""Produce Android-readable static cuts from the licensed web variable fonts."""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "mobile" / "assets" / "fonts"
TARGET = ROOT / "mobile" / "android" / "app" / "src" / "main" / "assets" / "fonts"
TARGET.mkdir(parents=True, exist_ok=True)

for family, weights in (("Manrope", (400, 500, 600, 700, 800)), ("Syne", (400, 500, 600, 700))):
    variable = SOURCE / f"{family}Variable.ttf"
    for weight in weights:
        font = TTFont(variable)
        instance = instantiateVariableFont(font, {"wght": weight}, inplace=True)
        instance.save(TARGET / f"{family}-W{weight}.ttf")
        instance.close()

(TARGET / "Michroma-Regular.ttf").write_bytes((SOURCE / "Michroma-Regular.ttf").read_bytes())
print(f"Bundled {len(list(TARGET.glob('*.ttf')))} font cuts in {TARGET}")

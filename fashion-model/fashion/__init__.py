"""Fashion model: a menswear rulebook that learns from videos and magazines, trained on
example outfits, and packed into one "fashion bible" file for the Smart Wardrobe app."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE = ROOT / "knowledge"
LEARNED = KNOWLEDGE / "learned"
BIBLE = ROOT / "bible"
APP_BIBLE = ROOT.parent / "fashion-bible.json"  # the slim copy the app loads (see bible.export_for_app)

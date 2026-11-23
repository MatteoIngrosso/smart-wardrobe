# CLHE experiment: a learnt "goes together" score (Stylist plan, step 8)

**Status: ready to start, needs Matteo's PC (RTX 3060) switched on.** Nothing here runs in the app yet.

## Why
The fashion bible's 27 rules catch mistakes (clashing colours, sneakers with a suit, shorts in winter).
On stylists' real outfits they barely tell the real outfit from the same outfit with one piece swapped:
58% (`python -m fashion bench`, 50% is chance). A model that learnt from photos which pieces go together
could fill that gap. [CLHE](https://github.com/Xiaohao-Liu/CLHE) (WSDM 2024) builds outfits ("bundles")
from image and text features of each item, and copes with items nobody has interacted with yet
(your pieces), which is why it's the one we try.

## The plan
1. **Train CLHE on POG** (Alibaba iFashion outfits, from https://huggingface.co/datasets/xhLiu/BundleConstruction;
   Hugging Face is blocked from the cloud, so it's downloaded on the PC). On the 3060 (12 GB) this should
   take hours, not days.
   - Check first which features the dataset ships (`content_feature.pt` = images, `description_feature.pt`
     or `openai_description_feature.pt` = text) and their size. If the text features come from OpenAI's paid
     embeddings, we don't use them: we extract our own with a free model (open_clip ViT-B/32 for images and
     text) for the POG items **and** for your pieces, and retrain on those. Your pieces must be in the same
     feature space as the training items, so one free extractor for both is the safe choice anyway.
2. **Your wardrobe** (from a backup, Settings > Export backup):
   `python clhe/export_wardrobe.py <backup.json> clhe-out` writes `items.json` (one text line per piece),
   `img/` (each piece's cut-out) and `worn.json` (outfits you wore or rated 4-5 stars). Tested on the
   16 Nov backup: 86 pieces, 86 photos, 17 worn or loved outfits. The folder holds your photos and is
   git-ignored.
3. **Score every pair** of your pieces (top + bottoms, bottoms + shoes, top + jacket...) with the trained model
   and save a small `pairs.json` ({"idA|idB": score}) into the app's shared data. The app then adds it
   to the outfit score like the pairs it learns from your wears (`taste().pairs`), offline, with the PC off.
   Re-run after adding pieces.
4. **Keep it only if it wins.** Two yardsticks, each "real outfit vs the same outfit with one piece swapped":
   your own `worn.json` outfits, and POG's own test outfits. The bible scores about 58% on the
   stylists' outfits; CLHE has to clearly beat the bible on your outfits. Then it's one more signal next
   to the bible, never a replacement.

## On the PC (Windows, when it's on)
```bat
cd C:\Users\matte\Documents\Wardrobe2.0
git pull
cd fashion-model\clhe
git clone https://github.com/Xiaohao-Liu/CLHE
python -m venv .venv && .venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install pyyaml tqdm tensorboard open_clip_torch pillow
:: dataset from Hugging Face into CLHE\datasets\ (see CLHE's README), then:
cd CLHE && python -u train.py -g 0 --dataset="pog_dense" --model="CLHE" --item_augment="MD" --bundle_augment="ID" --bundle_ratio=0.5 --bundle_cl_temp=0.05 --bundle_cl_alpha=2 --cl_temp=0.5 --cl_alpha=0.1
```
The Stylist lead runs these through a Remote Control session and writes the feature and pair-scoring
scripts there, where they can be tested on the GPU. Steps 3 and 4 come after that, as their own PR.

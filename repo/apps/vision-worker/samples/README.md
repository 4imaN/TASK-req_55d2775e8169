# Vision Worker – Local Test Images

Place sample face images in this directory for local development and manual testing.

## Purpose

The `samples/` directory provides a convenient location for static test images when
exercising the vision worker endpoints without a live camera feed.

## Naming convention

```
samples/
  enroll/
    <user_id>_01.jpg      # First enrollment sample for a user
    <user_id>_02.jpg
    <user_id>_03.jpg      # Minimum 3 samples required for enrollment
  recognize/
    probe_01.jpg          # Images to test recognition against enrolled set
    probe_02.png
```

## Format requirements

| Property       | Requirement                        |
|----------------|------------------------------------|
| File formats   | JPEG, PNG, BMP (OpenCV-compatible) |
| Colour space   | BGR or RGB (OpenCV converts)       |
| Minimum size   | 64 × 64 pixels                     |
| Recommended    | 300 × 300+ pixels, frontal face    |
| Faces per image| Exactly 1 per enrollment sample    |

## Usage examples

### Enroll via curl

```bash
# Encode images as base64
IMG1=$(base64 -i samples/enroll/alice_01.jpg)
IMG2=$(base64 -i samples/enroll/alice_02.jpg)
IMG3=$(base64 -i samples/enroll/alice_03.jpg)

curl -s -X POST http://localhost:5000/api/v1/vision/enroll \
  -H 'Content-Type: application/json' \
  -d "{
    \"user_id\": \"alice\",
    \"image_samples\": [\"$IMG1\", \"$IMG2\", \"$IMG3\"],
    \"consent_metadata\": {
      \"consent_given\": true,
      \"consent_timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"consent_actor\": \"admin\"
    }
  }"
```

### Detect faces via curl

```bash
curl -s -X POST http://localhost:5000/api/v1/vision/detect \
  -F "frame=@samples/recognize/probe_01.jpg"
```

### Recognise via curl

```bash
PROBE=$(base64 -i samples/recognize/probe_01.jpg)

curl -s -X POST http://localhost:5000/api/v1/vision/recognize \
  -H 'Content-Type: application/json' \
  -d "{\"image\": \"$PROBE\", \"camera_id\": \"cam_entrance\"}"
```

## Privacy notes

- These sample images are for **local development only**.
- Never commit real individuals' photographs to this directory.
- Use anonymised or synthetic face images (e.g., from open datasets like
  [Labeled Faces in the Wild](http://vis-www.cs.umass.edu/lfw/)) for testing.
- The `.gitignore` in this directory ignores `*.jpg`, `*.jpeg`, `*.png`, and `*.bmp`
  to prevent accidental commits of real photos.

## .gitignore

The samples directory ships with a `.gitignore` that excludes image files:

```
*.jpg
*.jpeg
*.png
*.bmp
*.tiff
*.gif
```

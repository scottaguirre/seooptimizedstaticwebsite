// test-wp-video-slot.js
//
// Which sections offer a "Video URL" field in wp-admin.
//
// WHAT THIS IS GUARDING
//
// The About page has three text-images sections. Only ONE of them — section4,
// the service area block — has a video slot: the static template renders a
// YouTube embed there in place of its single image. Sections 2 and 3 carry two
// images each and have no way to show a video at all.
//
// The meta box gated the field on the section TYPE, so it appeared on all
// three. Two of those could set a video that the downloaded site has no markup
// to render — the exported theme and the static build disagreeing, which is
// the one thing this export is not allowed to do.
//
// Edwin found it by looking at wp-admin: "I think the option of the video is
// just for the last section showing an image. It's not meant for every section
// that contains an image just for the last one."
//
//   node test-wp-video-slot.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { normaliseSection } = require('./utils/wpThemeBuilder/dataFiles/themeModel');

let passed = 0, failed = 0;
const DECLARED = 8;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

/** section4 on the About page, as buildAboutUsPage builds it. */
const LOCATION_SECTION = {
  key: 'section4', label: 'Our Service Area', type: 'text-images',
  paragraphs: ['We serve the area.'], images: [],
  videoUrl: '', cssClass: 'section-5', mediaLayout: 'side',
  supportsVideo: true,
};

/** A two-image block. Same type, no video slot. */
const TWO_IMAGE_SECTION = {
  key: 'section2', label: 'Section 2', type: 'text-images',
  paragraphs: ['Some copy.'], images: [],
};

console.log('\nWordPress video slot\n');

test('THE SLOT IS DECLARED BY THE SECTION, NOT INFERRED FROM ITS TYPE', () => {
  /* Three sections share the type 'text-images'. Only one has the slot, so
   * the type cannot be the thing that decides. */
  assert.strictEqual(normaliseSection(LOCATION_SECTION).supports_video, true);
  assert.strictEqual(normaliseSection(TWO_IMAGE_SECTION).type, 'text-images',
    'the fixture stopped being the same type, so this test proves nothing');
  assert.ok(!('supports_video' in normaliseSection(TWO_IMAGE_SECTION)),
    'a two-image section claims a video slot');
});

test('normaliseSection carries the flag — it is a whitelist', () => {
  /* The reviews section was dropped here silently once already. Anything the
   * meta boxes or the renderer need has to have a line in that function. */
  const model = read('utils/wpThemeBuilder/dataFiles/themeModel.js');
  assert.match(model, /section\.supportsVideo/,
    'themeModel drops supportsVideo, so the field never appears anywhere');
});

test('the flag is a LAYOUT hint, so the descriptor carries it to the meta box', () => {
  /* $content_keys lists what gets written to its own post-meta field.
   * Anything not on that list rides along in the descriptor blob, which is
   * where the meta box reads $s from. supports_video must NOT be a content
   * key or the meta box will never see it. */
  const activation = read('utils/wpThemeBuilder/generators/themeActivationPhp.js');
  const keys = activation.match(/\$content_keys = array\(([\s\S]*?)\);/)[1];

  assert.ok(!keys.includes('supports_video'),
    'supports_video is treated as content, so it never reaches the descriptor');
});

test('THE META BOX GATES ON THE SECTION, NOT THE TYPE', () => {
  const boxes = read('utils/wpThemeBuilder/generators/metaBoxesPhp.js');

  assert.match(boxes, /if \( ! empty\( \$s\['supports_video'\] \) \) \{/,
    'the video field is not gated on supports_video');

  // The old gate, which put the field on all three sections.
  assert.ok(!/if \( \$type === 'text-images' \) \{\s*\$\{p\}_text_field\( \$post->ID, \$key, 'video_url'/.test(boxes),
    'the video field is still gated on the section type');
});

test('ONLY ONE SECTION IN THE WHOLE BUILD DECLARES A VIDEO SLOT', () => {
  /* If a second one ever appears, it should be a deliberate edit with a look
   * at whether the static template can actually render it there. */
  const about = read('utils/buildAboutUsPage.js');
  const matches = about.match(/supportsVideo:\s*true/g) || [];

  assert.strictEqual(matches.length, 1,
    `${matches.length} sections declare a video slot; the static page has one`);
});

test('it is the service-area section that has it', () => {
  const about = read('utils/buildAboutUsPage.js');
  const idx = about.indexOf('supportsVideo: true');

  // The flag sits in the same extra block as the section4 key.
  const before = about.slice(Math.max(0, idx - 1600), idx);
  assert.ok(before.includes("key: 'section4'"),
    'supportsVideo is not on the section4 service-area block');
});

test('the section still carries its video url alongside the flag', () => {
  // The flag says the slot exists; videoUrl is what goes in it. Losing the
  // second would leave an always-empty field.
  const about = read('utils/buildAboutUsPage.js');
  const idx = about.indexOf('supportsVideo: true');
  const around = about.slice(Math.max(0, idx - 1600), idx + 400);

  assert.ok(around.includes('videoUrl: globalValues.youtubeVideoUrl'),
    'the service-area section no longer passes the video URL');
});

test('an empty video url still leaves the field editable', () => {
  /* A customer who supplied no video must still be able to add one later —
   * so the FIELD depends on supports_video, never on the url being set. */
  const withNoVideo = normaliseSection(
    Object.assign({}, LOCATION_SECTION, { videoUrl: '' })
  );

  assert.strictEqual(withNoVideo.supports_video, true);
  assert.ok(!('video_url' in withNoVideo),
    'an empty url is being stored, which is harmless but no longer the gate');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

console.log('');
process.exit(failed === 0 ? 0 : 1);

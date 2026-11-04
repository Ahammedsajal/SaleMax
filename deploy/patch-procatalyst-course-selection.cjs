'use strict';

const fs = require('node:fs');

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  console.error('Usage: node patch-procatalyst-course-selection.cjs <live-source> <output>');
  process.exit(2);
}

const source = sourcePath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(sourcePath, 'utf8');
const helper = `function isBareCourseSelection(message, context) {
  if (Number(context?.explicitCourses) !== 1 || !context?.selectedCourseCode) return false;
  const words = normalized(message).split(/\\s+/u).filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;
  return !/\\b(?:what|which|who|where|when|why|how|can|could|would|should|is|are|do|does|did|tell|explain|details?|information|info|price|fee|cost|duration|long|schedule|batch|certificate|certification|accreditation|online|offline|compare|recommend|need|want|please|about)\\b|[?؟]/iu.test(String(message || ''));
}`;

if (source.includes('function isBareCourseSelection(') || source.includes('isBareCourseSelection,')) {
  throw new Error('COURSE_SELECTION_HELPER_ALREADY_PRESENT');
}
const tokenAnchor = "const tokens = value => normalized(value).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word));";
const exportAnchor = 'shouldClarifyGenericCourseInterest, previewState';
if (source.split(tokenAnchor).length !== 2 || source.split(exportAnchor).length !== 2) {
  throw new Error('UNEXPECTED_CHATBOT_BUSINESS_CONTEXT_SHAPE');
}
const output = source
  .replace(tokenAnchor, `${tokenAnchor}\n${helper}`)
  .replace(exportAnchor, 'shouldClarifyGenericCourseInterest, isBareCourseSelection, previewState');
if (!output.includes('isBareCourseSelection, previewState')) throw new Error('COURSE_SELECTION_EXPORT_MISSING');

if (outputPath === '-') process.stdout.write(output);
else fs.writeFileSync(outputPath, output, { mode: 0o644 });

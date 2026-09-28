// Which files in a diff are churn (lockfiles, generated code, snapshots), so
// the diff view can start them collapsed (#18). Two signals: the path itself,
// and the reading guide, which files churn into a last section whose title
// says so ("Churn", "Lockfile and generated files"). Pure, for the test.

const CHURN_PATHS: RegExp[] = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /(^|\/)(Gemfile\.lock|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum|Podfile\.lock)$/,
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /(^|\/)(__generated__|generated|gen)\//,
  /\.generated\.[a-z]+$/,
  /\.min\.(js|css)$/,
  /(^|\/)(dist|vendor)\//,
  /(^|\/)db\/schema\.rb$/,
  /(^|\/)db\/structure\.sql$/,
];

export function isChurnPath(path: string): boolean {
  return CHURN_PATHS.some((re) => re.test(path));
}

const CHURN_TITLE = /\b(churn|lock ?files?|generated|formatting|fixtures?|snapshots?|vendored|boilerplate)\b/i;

/** The files the guide groups under a churn section. */
export function churnFromGuide(sections: { title: string; files: string[] }[]): Set<string> {
  const out = new Set<string>();
  for (const s of sections) if (CHURN_TITLE.test(s.title)) for (const f of s.files) out.add(f);
  return out;
}

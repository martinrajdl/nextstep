export const profileFields = [
  { key: 'roles', label: 'Roles and work you want', hint: 'What kind of job are you looking for? Describe the work and level you want.', maxLength: 2000 },
  { key: 'locations', label: 'Location and work eligibility', hint: 'Where can you work? Include countries, timezone limits, travel or relocation.', maxLength: 2000 },
  { key: 'workStyle', label: 'Work arrangement', hint: 'Your preferences for working remotely, on site, or a mix of both.', maxLength: 1000 },
  { key: 'employmentType', label: 'Employment type and hours', hint: 'Your preferred contract type, hours, and availability.', maxLength: 1000 },
  { key: 'compensation', label: 'Compensation expectations', hint: 'Include currency, pay period, and whether a target is flexible or a minimum.', maxLength: 1000 },
  { key: 'experience', label: 'Experience and strengths', hint: 'Relevant experience, qualifications, skills, and evidence you want considered.', maxLength: 8000 },
  { key: 'preferences', label: 'Company preferences and priorities', hint: 'Industries, company size, values, responsibilities, or other things that matter to you.', maxLength: 4000 },
  { key: 'exclusions', label: 'Things to avoid', hint: 'Any roles, industries, companies, or working conditions you do not want.', maxLength: 4000 },
] as const;

export type SearchProfileDraft = Record<typeof profileFields[number]['key'], string>;
export type SearchProfile = SearchProfileDraft & { version: number; updatedAt: string | null };
export const profileDraft = (profile: SearchProfile): SearchProfileDraft => Object.fromEntries(profileFields.map(({key}) => [key, profile[key]])) as SearchProfileDraft;

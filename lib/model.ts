export const STAGES = [
  { id: 'uninterested', name: 'Uninterested', color: '#a18e98', hint: 'Not a fit right now', closed: false },
  { id: 'prospect', name: 'Prospects', color: '#7b8497', hint: 'Companies on your radar', closed: false },
  { id: 'interested', name: 'Interested', color: '#4e969d', hint: 'Opportunities worth pursuing', closed: false },
  { id: 'applied', name: 'Applied', color: '#5279dc', hint: 'Applications sent', closed: false },
  { id: 'screening', name: 'Screening', color: '#9a6bdd', hint: 'First conversations', closed: false },
  { id: 'interview', name: 'Interview', color: '#dd9953', hint: 'Getting to know the team', closed: false },
  { id: 'final', name: 'Final round', color: '#d37499', hint: 'The home stretch', closed: false },
  { id: 'offer', name: 'Offer', color: '#45987b', hint: 'Your next opportunity', closed: false },
  { id: 'accepted', name: 'Accepted', color: '#45987b', hint: 'A new chapter', closed: true },
  { id: 'rejected', name: 'Not moving forward', color: '#b87985', hint: 'Room for something better', closed: true },
  { id: 'withdrawn', name: 'Withdrawn', color: '#8a91a1', hint: 'A different direction', closed: true },
] as const;
export type StageId = typeof STAGES[number]['id'];
export type Opportunity = {
  id: string; company: string; role: string; location: string; salary: string; url: string; contact: string; contactEmail: string;
  priority: 'normal' | 'high' | 'low'; nextStep: string; followUp: string; notes: string; stage: StageId;
  position: number; version: number; createdAt: string; updatedAt: string;
};
export type Draft = Omit<Opportunity, 'id' | 'position' | 'version' | 'createdAt' | 'updatedAt'>;
export type Activity = { action: string; fromStage: StageId | null; toStage: StageId | null; createdAt: string };
export const blankDraft = (stage: StageId = 'prospect'): Draft => ({ company: '', role: '', location: '', salary: '', url: '', contact: '', contactEmail: '', priority: 'normal', nextStep: '', followUp: '', notes: '', stage });
export const stageInfo = (id: string) => STAGES.find(stage => stage.id === id) || STAGES.find(stage => stage.id === 'prospect')!;
export function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function dateLabel(date: string) { if (!date) return ''; if (date === today()) return 'Today'; return new Date(date+'T12:00:00').toLocaleDateString(undefined,{ month: 'short', day: 'numeric' }); }
export function initials(company: string) { return company.split(/\s+/).filter(Boolean).slice(0,2).map(word => word[0]).join('').toUpperCase(); }
export function companyColor(company: string) { const colors = ['#5567a9', '#8b62a9', '#458c89', '#b07d4e', '#a56986', '#637f9c']; return colors[Array.from(company).reduce((n,c) => n+c.charCodeAt(0),0)%colors.length]; }
export async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const options: RequestInit = { method, signal: AbortSignal.timeout(12000) };
  if (method !== 'GET' && data !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  }
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not reach the local app. Please try again.');
  return result;
}

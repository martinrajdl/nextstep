// Starter schemas contain no records or personal data. They are created only on request.
export const CRM_TEMPLATES = [
  {
    id: 'people',
    name: 'People',
    description:
      'Keep relationships, context, and the next conversation together.',
    color: '#718278',
    fields: [
      { key: 'email', name: 'Email', type: 'email', unique: true },
      { key: 'company', name: 'Company', type: 'text' },
      {
        key: 'status',
        name: 'Relationship',
        type: 'select',
        options: ['New', 'In touch', 'Close'],
      },
      { key: 'last_contact', name: 'Last contact', type: 'date' },
      { key: 'notes', name: 'Notes', type: 'longtext' },
    ],
  },
  {
    id: 'companies',
    name: 'Companies',
    description: 'A shared source of truth for organizations you care about.',
    color: '#8c7865',
    fields: [
      { key: 'website', name: 'Website', type: 'url', unique: true },
      { key: 'industry', name: 'Industry', type: 'text' },
      {
        key: 'status',
        name: 'Status',
        type: 'select',
        options: ['Researching', 'Qualified', 'Working together', 'Archived'],
      },
      { key: 'notes', name: 'Notes', type: 'longtext' },
    ],
  },
  {
    id: 'projects',
    name: 'Projects',
    description: 'Track what you are building and what needs to happen next.',
    color: '#787393',
    fields: [
      {
        key: 'status',
        name: 'Status',
        type: 'select',
        options: ['Backlog', 'In progress', 'In review', 'Done'],
      },
      {
        key: 'priority',
        name: 'Priority',
        type: 'select',
        options: ['Low', 'Medium', 'High'],
      },
      { key: 'due_date', name: 'Due date', type: 'date' },
      { key: 'description', name: 'Description', type: 'longtext' },
    ],
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Turn links and loose findings into a useful knowledge base.',
    color: '#68818a',
    fields: [
      { key: 'source', name: 'Source', type: 'url' },
      {
        key: 'status',
        name: 'Status',
        type: 'select',
        options: ['Inbox', 'Reading', 'Reviewed'],
      },
      { key: 'topic', name: 'Topic', type: 'text' },
      { key: 'summary', name: 'Summary', type: 'longtext' },
      { key: 'verified', name: 'Verified', type: 'checkbox' },
    ],
  },
  {
    id: 'deals',
    name: 'Deals',
    description: 'Follow opportunities from first conversation to a decision.',
    color: '#b08556',
    fields: [
      { key: 'company', name: 'Company', type: 'text' },
      {
        key: 'stage',
        name: 'Stage',
        type: 'select',
        options: ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'],
      },
      { key: 'value', name: 'Value', type: 'number' },
      { key: 'close_date', name: 'Close date', type: 'date' },
      { key: 'notes', name: 'Notes', type: 'longtext' },
    ],
  },
];

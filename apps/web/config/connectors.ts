import type { Icons } from '@/components/icons';

/**
 * The services SYRIX Forma can be connected to, what each one needs, and where to get it.
 *
 * Two rules this file exists to enforce.
 *
 * **Say where the key comes from.** The complaint this page answers was not "there is no
 * connectors screen", it was "where do I put the API key or the MCP URL". Every field below
 * carries the actual click path inside that service. A form that says "API key" and nothing else
 * is a form nobody can fill in without leaving the app to search.
 *
 * **Never imply something works when it does not.** `usedBy` names the Hub feature that consumes
 * a connector. An entry with `usedBy: null` is listed so the shape of what is possible is
 * visible, and is shown in its own section saying plainly that connecting it would currently do
 * nothing — rather than offering a form that stores a credential nothing reads. the engineering rules
 * Section 7: label a stub loudly, do not dress it as a feature.
 *
 * Logos are Tabler's brand glyphs (already a dependency), not fetched images — an artifact of
 * this app being self-contained, and the reason the marks are monochrome on a brand-coloured
 * tile rather than the full-colour originals.
 */

export type ConnectorField = {
  name: string;
  label: string;
  /** Rendered as a password field and never read back once saved. */
  secret: boolean;
  placeholder?: string;
  /** The literal path through that service's own interface. */
  whereToFind: string;
};

export type ConnectorCatalogueEntry = {
  key: string;
  name: string;
  category: 'Mail and calendar' | 'Files' | 'Messaging' | 'Work and finance' | 'AI and automation';
  /** Tabler brand icon name, resolved in the connectors UI. */
  icon: keyof typeof Icons;
  /** Brand colour for the tile. */
  tint: string;
  /** What connecting it does in this Hub, in one sentence. */
  summary: string;
  /**
   * The Hub feature that reads this connector's credential. Null means nothing does yet, and the
   * entry is shown as not wired up rather than offered as a connection.
   */
  usedBy: string | null;
  kind: 'mcp' | 'http_api' | 'built_in';
  fields?: ConnectorField[];
  /** Where the service's own documentation for the credential lives. */
  docsUrl?: string;
};

export const CONNECTOR_CATALOGUE: ConnectorCatalogueEntry[] = [
  {
    key: 'hostinger_mail',
    name: 'Hostinger Mail',
    category: 'Mail and calendar',
    icon: 'mail',
    tint: '#673de6',
    summary:
      'Detects enquiries arriving in the company mailbox, files them against clients, and sends replies from the Hub so the exchange stays on the record.',
    usedBy: 'Email and Enquiries',
    kind: 'built_in'
  },
  {
    key: 'mcp',
    name: 'MCP server',
    category: 'AI and automation',
    icon: 'sparkles',
    tint: '#d97757',
    summary:
      'Any Model Context Protocol server, reached over HTTP. The Hub performs a real handshake, records which tools the server exposes, and re-checks on demand.',
    usedBy: 'Connectors (verification and tool discovery)',
    kind: 'mcp',
    fields: [
      {
        name: 'baseUrl',
        label: 'Server URL',
        secret: false,
        placeholder: 'https://example.com/mcp',
        whereToFind:
          'The address the server documents for Streamable HTTP — usually ending in /mcp. It must be https, unless it is running on this machine.'
      },
      {
        name: 'token',
        label: 'Bearer token (if it needs one)',
        secret: true,
        whereToFind:
          'Whatever the server issues you. Sent as an Authorization: Bearer header and never shown again once saved. Leave blank for a server that needs no authentication.'
      }
    ],
    docsUrl: 'https://modelcontextprotocol.io/docs/concepts/transports'
  },
  {
    key: 'http_api',
    name: 'Any HTTP API',
    category: 'AI and automation',
    icon: 'settings',
    tint: '#475569',
    summary:
      'A service behind a bearer token or an API key header. The Hub stores the credential encrypted and verifies it against an endpoint you name.',
    usedBy: 'Connectors (verification)',
    kind: 'http_api',
    fields: [
      {
        name: 'baseUrl',
        label: 'Endpoint to verify against',
        secret: false,
        placeholder: 'https://api.example.com/v1/me',
        whereToFind:
          'Any endpoint that returns 200 for a valid credential and 401 for a bad one — typically the "who am I" or "current user" route in that API\'s documentation.'
      },
      {
        name: 'headerName',
        label: 'Header name',
        secret: false,
        placeholder: 'Authorization',
        whereToFind:
          'From the API\'s authentication documentation. "Authorization" for a bearer token, or something like "X-API-Key" for a key.'
      },
      {
        name: 'headerValue',
        label: 'Header value',
        secret: true,
        placeholder: 'Bearer sk_live_…',
        whereToFind:
          'The credential itself, written exactly as the header expects it — include the word "Bearer" if the documentation shows it.'
      }
    ]
  },
  {
    key: 'slack',
    name: 'Slack',
    category: 'Messaging',
    icon: 'brandSlack',
    tint: '#4a154b',
    summary: 'Post notifications into a channel instead of, or as well as, in-app notifications.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'notion',
    name: 'Notion',
    category: 'Work and finance',
    icon: 'brandNotion',
    tint: '#0f0f0f',
    summary: 'Read and write pages in a Notion workspace from projects and clients.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'google_drive',
    name: 'Google Drive',
    category: 'Files',
    icon: 'brandGoogleDrive',
    tint: '#1a73e8',
    summary: 'Browse and link Drive files without leaving a client or project record.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'google_calendar',
    name: 'Google Calendar',
    category: 'Mail and calendar',
    icon: 'brandGoogle',
    tint: '#1a73e8',
    summary: 'Two-way sync between Hub events and a Google calendar.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'onedrive',
    name: 'OneDrive and SharePoint',
    category: 'Files',
    icon: 'brandOnedrive',
    tint: '#0364b8',
    summary:
      'Browse files directly. Linking to them already works today and needs no credential — see Documents.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'microsoft_teams',
    name: 'Microsoft Teams',
    category: 'Messaging',
    icon: 'brandTeams',
    tint: '#5059c9',
    summary: 'Post Hub notifications into a Teams channel.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'dropbox',
    name: 'Dropbox',
    category: 'Files',
    icon: 'brandDropbox',
    tint: '#0061ff',
    summary: 'Browse and link Dropbox files from client and project records.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'stripe',
    name: 'Stripe',
    category: 'Work and finance',
    icon: 'brandStripe',
    tint: '#635bff',
    summary: 'Show invoice and payment status against a client.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'zoom',
    name: 'Zoom',
    category: 'Mail and calendar',
    icon: 'brandZoom',
    tint: '#2d8cff',
    summary: 'Create a meeting link when a calendar event is created.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'github',
    name: 'GitHub',
    category: 'Work and finance',
    icon: 'brandGithub',
    tint: '#24292f',
    summary: 'Link issues and pull requests to tasks.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'airtable',
    name: 'Airtable',
    category: 'Work and finance',
    icon: 'brandAirtable',
    tint: '#18bfff',
    summary: 'Read a base as a data source for reports.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'trello',
    name: 'Trello',
    category: 'Work and finance',
    icon: 'brandTrello',
    tint: '#0079bf',
    summary: 'Import cards as tasks.',
    usedBy: null,
    kind: 'http_api'
  },
  {
    key: 'asana',
    name: 'Asana',
    category: 'Work and finance',
    icon: 'brandAsana',
    tint: '#f06a6a',
    summary: 'Import tasks from an Asana project.',
    usedBy: null,
    kind: 'http_api'
  }
];

export const CONNECTABLE_NOW = CONNECTOR_CATALOGUE.filter((entry) => entry.usedBy !== null);
export const NOT_WIRED_UP = CONNECTOR_CATALOGUE.filter((entry) => entry.usedBy === null);

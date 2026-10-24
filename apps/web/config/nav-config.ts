import { NavGroup } from '@/types';

/**
 * SYRIX Forma primary navigation — engineering rule 5.
 *
 * The full structure is built in Phase 0 so it never needs re-architecting
 * later (engineering rule 5). Items whose phase hasn't shipped yet carry
 * `disabled` + `phase` so the sidebar can grey them out with a "coming in
 * Phase N" tooltip instead of a broken or missing link.
 *
 * SYRIX Forma is single-tenant, not a multi-org SaaS (DEPENDENCIES.md's Phase 0
 * decision) — there is no client-side nav filtering here at all. Every real
 * enforcement decision happens server-side in lib/permissions/ (the engineering rules
 * Section 10); hiding a nav item is never itself a security control.
 */
export const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      {
        title: 'Home',
        url: '/dashboard',
        icon: 'dashboard',
        shortcut: ['h', 'h'],
        items: []
      },
      {
        title: 'My Work',
        url: '/dashboard/my-work',
        icon: 'checks',
        items: []
      },
      {
        title: 'Clients',
        url: '/dashboard/clients',
        icon: 'teams',
        items: []
      },
      {
        title: 'Projects',
        url: '/dashboard/projects',
        icon: 'workspace',
        items: []
      },
      {
        title: 'Calendar',
        url: '/dashboard/calendar',
        icon: 'calendar',
        items: []
      },
      {
        title: 'Email',
        url: '/dashboard/email',
        icon: 'chat',
        items: []
      },
      {
        title: 'Team Chat',
        url: '/dashboard/chat',
        icon: 'teamChat',
        items: []
      },
      {
        title: 'Documents',
        url: '/dashboard/documents',
        icon: 'page',
        items: []
      },
      {
        title: 'Teams',
        url: '/dashboard/teams',
        icon: 'teams',
        items: []
      },
      {
        // One entry, not one per HR area — the eleven areas are sub-tabs inside the module
        // (config/hr-nav.ts). Placed after Teams because both are about people rather than
        // client work, so the sidebar keeps delivery and people concerns in separate runs.
        title: 'HR',
        url: '/dashboard/hr',
        icon: 'hr',
        items: []
      },
      {
        title: 'Automations',
        url: '/dashboard/automations',
        icon: 'sparkles',
        items: []
      },
      {
        title: 'Reports',
        url: '/dashboard/reports',
        icon: 'trendingUp',
        items: []
      },
      {
        title: 'SYRIX AI',
        url: '/dashboard/forma-ai',
        icon: 'sparkles',
        items: []
      }
    ]
  },
  {
    label: '',
    items: [
      {
        title: 'Settings',
        url: '/dashboard/settings',
        icon: 'settings',
        shortcut: ['s', 's'],
        items: [
          {
            title: 'Account & Security',
            url: '/dashboard/settings',
            icon: 'account'
          },
          {
            title: 'People & Access',
            url: '/dashboard/settings/access',
            icon: 'shield'
          },
          {
            title: 'Connectors',
            url: '/dashboard/settings/connectors',
            icon: 'plug'
          },
          {
            title: 'Integrations',
            url: '/dashboard/settings/integrations',
            icon: 'settings'
          },
          {
            title: 'Project Templates',
            url: '/dashboard/settings/project-templates',
            icon: 'workspace'
          },
          {
            title: 'SYRIX AI',
            url: '/dashboard/settings/forma-ai',
            icon: 'sparkles'
          },
          {
            title: 'Sign out',
            shortcut: ['l', 'l'],
            url: '/',
            icon: 'logout'
          }
        ]
      }
    ]
  }
];

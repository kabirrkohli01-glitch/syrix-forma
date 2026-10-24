import type { InfobarContent } from '@/components/ui/infobar';

/**
 * The "what is this screen and what do I do here" panel for every page.
 *
 * engineering rule 17 requires each screen to answer: what am I looking at, what can I do here,
 * what needs my attention, what happened, what happens next. A page title and a one-line
 * description carry the first of those and none of the rest, which is why several screens read as
 * a wall of controls with no obvious starting point.
 *
 * The info panel that renders these already existed (`components/ui/infobar.tsx`, mounted in the
 * dashboard layout and opened by the ⓘ button beside a page title, or Ctrl/Cmd-I) and no page
 * passed it any content, so it only ever showed the starter template's placeholder text. These
 * are the real ones.
 *
 * Rules for writing one:
 *
 * - Say what the screen is for in the first section, in one sentence, without naming a component.
 * - Then "How to …" — the actual click path, naming the button as it is labelled on screen. A
 *   guide that says "create a record" when the button says "New client" is not a guide.
 * - Then what decides visibility, wherever a screen shows different people different things.
 *   Most "why can't I see anything" confusion in this app is a permission answering correctly.
 * - No links to documentation that does not exist. `links` is for real destinations only.
 */

const PERMISSION_NOTE =
  'Every screen in the Hub shows you only what your role and team allow, and that is decided on the server — a short list is usually the rules working, not a fault. Settings → People & Access is where an administrator changes it.';

export const ACCESS_CONTROL_GUIDE: InfobarContent = {
  title: 'People & Access',
  sections: [
    {
      title: 'What this is',
      description:
        'Every person who has ever signed in to the Hub, the role that decides what they can reach, and the two extra permissions that sit alongside a role rather than replacing it.'
    },
    {
      title: 'How to let someone in',
      description:
        'They sign in once with their the organisation email address; that puts them at the top of this page as pending, able to reach nothing. Pick a role and a team, then press "Approve with this role". You will be asked for your authenticator code first — every change on this page is.'
    },
    {
      title: 'How to give yourself HR',
      description:
        'Roles are one-per-person, so being ADMIN does not include HR, and switching your own role to HR_ADMIN would take away the screen you are reading. Turn on "HR administration" on your own card instead. It keeps your ADMIN role and adds the whole HR module: leave policy, allowances, absence, documents.'
    },
    {
      title: 'What each role means',
      description:
        'EMPLOYEE sees their own work. TEAM_LEAD sees their team and assigns within it. MANAGER sees every team plus reports. ADMIN runs the platform — people, integrations, automations — and deliberately not HR records. SECURITY_ADMIN sees sessions and the audit log and no business data. HR_ADMIN is the HR module and no business data.'
    },
    {
      title: 'Switching someone off',
      description:
        'This bans their sign-in account, clears their role and extra access, and unassigns every open task they held so their team lead can hand the work over. Nothing is deleted: the record and the audit trail stay. You cannot do it to your own account.'
    }
  ]
};

export const HR_PEOPLE_GUIDE: InfobarContent = {
  title: 'HR — People',
  sections: [
    {
      title: 'What this is',
      description:
        'The staff record for everyone you are entitled to see: employment detail, and for HR, the identity and pay bands too.'
    },
    {
      title: 'Who you can see here',
      description:
        'Yourself always. Anyone whose line manager is set to you. And, with HR administration, everyone. Line management is a named person on each record, not the team column — set it on a person’s record so their leave and timesheets have somewhere to go for approval.'
    },
    {
      title: 'How to add someone',
      description:
        'People are not created here. They sign in with their the organisation email address, an administrator approves them in Settings → People & Access, and their record then appears on this page for HR to fill in.'
    },
    {
      title: 'What is deliberately restricted',
      description:
        'Date of birth, National Insurance number and home address are visible to the person themselves and to HR only — a line manager does not get them. Pay adds finance users. Sickness detail follows the same rule as identity.'
    }
  ]
};

export const HR_SETTINGS_GUIDE: InfobarContent = {
  title: 'HR settings',
  sections: [
    {
      title: 'What this is',
      description:
        'The company-wide rules the rest of the HR module runs on. Nothing here is about one person: it is the leave year, the types of leave that exist, and how much everyone gets by default.'
    },
    {
      title: 'How to set how many days people get',
      description:
        'Set the company default under "Leave policy" — it applies to everyone who has no individual figure. Then, for anyone on different terms, set their own allowance under "Individual allowances". An individual figure always wins over the default, and clearing it puts that person back on the default rather than on zero.'
    },
    {
      title: 'How allowance is counted',
      description:
        'In half days, so a half-day booking is a real one rather than a rounding. A leave type marked "does not deduct" (unpaid, jury service) is still booked and still shows on the calendar, but never comes off the balance.'
    },
    {
      title: 'Changing the leave year',
      description:
        'Balances are counted from the leave year start you set here. Changing it mid-year re-counts every balance against the new window, which is correct but will move people’s numbers — pick it once, at the start.'
    }
  ]
};

export const HR_TIME_OFF_GUIDE: InfobarContent = {
  title: 'Time Off',
  sections: [
    {
      title: 'What this is',
      description:
        'Your allowance and what is left of it, everything you have booked this leave year, and anything waiting on your decision if you approve other people’s leave.'
    },
    {
      title: 'How to book time off',
      description:
        'Press "Book time off", pick the type and the dates, and mark the first or last day as a half day if it is one. The number of days is worked out from the company working week and shown before you submit — you never type it yourself.'
    },
    {
      title: 'Who approves it',
      description:
        'Your line manager, if one is set on your record. If nobody is, it goes to HR instead of to nobody. You cannot approve your own request whatever your role, and a manager declines a request rather than cancelling it — cancelling is the requester changing their mind.'
    },
    {
      title: 'If nothing can be booked',
      description:
        'No leave types have been set up yet. Someone with HR administration creates them in HR → Settings; until then there is nothing for a request to be a request for.'
    }
  ]
};

export const HR_ABSENCE_GUIDE: InfobarContent = {
  title: 'Absence',
  sections: [
    {
      title: 'What this is',
      description:
        'Sickness and unplanned absence: who is off, since when, and whether a return-to-work conversation has happened.'
    },
    {
      title: 'How to record one',
      description:
        'Press "Record absence". You can record your own, and a line manager can record one for someone who reports to them — people phone in, and the record should not wait for them to come back and enter it.'
    },
    {
      title: 'What a line manager sees and does not',
      description:
        'The dates, so they can plan the work. Not the reason, the notes or the fit note: that is health data, and it stays with the person themselves and with HR.'
    },
    {
      title: 'Return to work',
      description:
        'Recorded against the absence by whoever held the conversation — never by the person returning, since an interview someone logs about themselves is not one.'
    }
  ]
};

export const HR_DOCUMENTS_GUIDE: InfobarContent = {
  title: 'HR Documents',
  sections: [
    {
      title: 'What this is',
      description:
        'Company policies everyone can read, and the documents on your own employment record — contracts, letters, anything personal.'
    },
    {
      title: 'How to add one',
      description:
        'HR uploads it and chooses whether it is a company document or belongs to one person. Turning on "requires acknowledgement" asks the audience to confirm they have read it, and records who has.'
    },
    {
      title: 'Who can see a personal document',
      description:
        'The person it belongs to, and HR. Deliberately not their line manager: a job title is employment detail a manager needs, and a disciplinary letter is not.'
    },
    {
      title: 'Business documents are elsewhere',
      description:
        'Proposals, client paperwork and anything attached to a project live in Documents, in the main navigation, under team permissions rather than HR’s.'
    }
  ]
};

export const HR_PERFORMANCE_GUIDE: InfobarContent = {
  title: 'Performance',
  sections: [
    {
      title: 'What this is',
      description:
        'Company goals, individual objectives, one-to-ones, appraisals and recognition — in one place because they are the same conversation at different lengths.'
    },
    {
      title: 'What you can do here',
      description:
        'Set your own objectives, or your reports’. Log a one-to-one. Write the self-review half of your own appraisal. Recognise anyone at the organisation, which needs no permission at all — a recognition wall with a permission tier is not one.'
    },
    {
      title: 'The private notes field',
      description:
        'A manager’s own notes on a one-to-one are visible to them and to HR, never to the employee the notes are about. That is written down rather than hidden: a manager with nowhere to record an impression keeps it out of the system entirely. It is still disclosable on a subject access request.'
    }
  ]
};

export const HR_ROTAS_GUIDE: InfobarContent = {
  title: 'Rotas',
  sections: [
    {
      title: 'What this is',
      description:
        'Who is working when, the hours people have recorded, and clock-ins where they are used.'
    },
    {
      title: 'What you can do here',
      description:
        'Clock in and out for yourself, fill in and submit your own hours, and offer a shift for swap. A line manager builds the rota for their reports and approves their hours.'
    },
    {
      title: 'Two rules that will not bend',
      description:
        'Nobody approves their own hours. And a shift swap needs a manager as well as the two people involved — a swap that only needs the other person’s agreement lets two employees rewrite the published rota between them.'
    }
  ]
};

export const HR_EXPENSES_GUIDE: InfobarContent = {
  title: 'Expenses',
  sections: [
    {
      title: 'What this is',
      description: 'Expense claims, their approval, and whether they have been paid.'
    },
    {
      title: 'How to claim',
      description:
        'Press "New claim", add the lines, attach the receipts and submit. Mileage uses the rate set in HR settings rather than one you type.'
    },
    {
      title: 'Why approving and paying are separate',
      description:
        'Approval says the spend was legitimate; marking it paid says the money left the account. The same person doing both unchecked is the classic expenses control gap, so they are different permissions.'
    }
  ]
};

export const HR_LEARNING_GUIDE: InfobarContent = {
  title: 'Learning',
  sections: [
    {
      title: 'What this is',
      description:
        'The course catalogue, who is enrolled on what, and training records against employment.'
    },
    {
      title: 'What you can do here',
      description:
        'Enrol yourself, or assign a course to someone who reports to you. Only the learner marks their own progress — a manager recording it for them is a fiction.'
    },
    {
      title: 'Adding a course',
      description: 'HR adds to the catalogue. Anyone can see what is in it.'
    }
  ]
};

export const HR_SAFETY_GUIDE: InfobarContent = {
  title: 'Safety',
  sections: [
    {
      title: 'What this is',
      description:
        'Risk assessments, the incident log, and who holds a safety role such as first aider or fire marshal.'
    },
    {
      title: 'How to report something',
      description:
        'Press "Report an incident". Anyone can report anything — a hazard, a near miss, an accident, including one that happened to somebody else. There is no permission tier on reporting, because under-reporting is the failure mode safety systems actually have.'
    },
    {
      title: 'What everyone sees',
      description:
        'That something happened, where, and what was done about it — that is how people learn to avoid it. Injury detail about a named person follows the same rule as sickness: that person, and HR.'
    }
  ]
};

export const HR_HIRING_GUIDE: InfobarContent = {
  title: 'Hiring',
  sections: [
    {
      title: 'What this is',
      description: 'Open vacancies, the applications against them, and interviews.'
    },
    {
      title: 'Who sees what',
      description:
        'Everyone sees open vacancies, because internal moves and referrals depend on it. Applications are visible to HR and to the named hiring manager only — a candidate is not an employee and has no place in the line-management chain.'
    },
    {
      title: 'When someone is hired',
      description:
        'Marking an application hired is a recruitment decision. Creating their account and employment record is a separate, HR-only act, because it has payroll and access consequences.'
    }
  ]
};

export const HR_REPORTS_GUIDE: InfobarContent = {
  title: 'HR Reports',
  sections: [
    {
      title: 'What this is',
      description:
        'Headcount, turnover, absence rates and leave liability across the company — aggregates, containing no one person’s record.'
    },
    {
      title: 'What to check first',
      description:
        'Employees with no line manager set. Their leave and timesheets have nobody to route to and fall through to HR, which is usually not what was intended.'
    },
    {
      title: 'Payroll export',
      description:
        'Produces a file containing every employee’s pay detail at once, which is a different risk from looking up one salary on screen. It asks for your authenticator code and is written to the audit log.'
    }
  ]
};

export const DOCUMENTS_GUIDE: InfobarContent = {
  title: 'Documents',
  sections: [
    {
      title: 'What this is',
      description:
        'Files that belong to the business — proposals, reports, signed paperwork — either uploaded into the Hub or linked to where they already live in SharePoint, OneDrive or the NAS.'
    },
    {
      title: 'How to add one',
      description:
        'Press "Upload" to put a file in the Hub, or "Link a file" to point at one that already exists elsewhere. Either way you can attach it to a client, a project or a task, which is what makes it findable from that record rather than only from this page.'
    },
    {
      title: 'Uploaded versus linked',
      description:
        'An uploaded file is stored by the Hub and downloaded through it, so access follows Hub permissions. A linked file stays where it is and the Hub only holds the address — whoever owns that system still decides who can open it, and the Hub checks periodically that the link still resolves.'
    },
    {
      title: 'HR paperwork is somewhere else',
      description:
        'Contracts, policies and anything needing an acknowledgement live in HR → Documents, under HR’s own permission rules. This page is business documents.'
    }
  ]
};

export const CONNECTORS_GUIDE: InfobarContent = {
  title: 'Connectors',
  sections: [
    {
      title: 'What this is',
      description:
        'Outside services the Hub can reach — mail, storage, calendars, accounting — and the one place their credentials are entered.'
    },
    {
      title: 'How to connect something',
      description:
        'Pick the service, and the panel tells you exactly which credential it needs and where in that service you generate it. Paste it in and press Connect. The Hub tests the credential before saving, so a connector that says connected has actually answered.'
    },
    {
      title: 'Where the key goes',
      description:
        'Into the Hub’s database, encrypted with AES-256-GCM using a key held in the server environment, and never rendered back to the browser afterwards — an already-connected service shows only its last four characters. Nothing you paste here is written to a log or to an error report.'
    },
    {
      title: 'Custom and MCP servers',
      description:
        'Anything not on the list can be added as a custom connector with its own base URL and token, including an MCP server. It is stored the same way and is subject to the same rule as everything else the Hub reads from the outside: content that arrives from it is data, never an instruction.'
    },
    {
      title: 'If a connector stops working',
      description:
        'A failed connector degrades the feature that uses it and never takes the Hub down. It shows as disconnected here with the last error, and whatever depended on it says so on its own screen rather than silently showing nothing.'
    }
  ]
};

export const HOME_GUIDE: InfobarContent = {
  title: 'Home',
  sections: [
    {
      title: 'What this is',
      description:
        'Everything with your name on it that is overdue, due soon, or waiting on a decision from you — ordered by urgency rather than by date created.'
    },
    {
      title: 'What you can do here',
      description:
        '"Customise" chooses which sections appear and in what order. Every card links through to the full screen behind it, so nothing here is a dead end.'
    },
    { title: 'Why your view differs from a colleague’s', description: PERMISSION_NOTE }
  ]
};

export const MY_WORK_GUIDE: InfobarContent = {
  title: 'My Work',
  sections: [
    {
      title: 'What this is',
      description:
        'Tasks — yours and, depending on your role, your team’s. The same set of tasks viewed as a list, a board, a calendar or a timeline; switching view never changes what is in it.'
    },
    {
      title: 'How to add one',
      description:
        'Press "New task". A task needs a title and nothing else, but giving it an assignee, a due date and a client is what makes it show up on the right person’s Home screen and in the right reports.'
    },
    {
      title: 'Sub-tasks, checklists and dependencies',
      description:
        'Open a task to reach them. A checklist is a tick list inside one task; a sub-task is its own task with its own assignee and due date; a dependency blocks a task until another finishes. Pick the lightest one that fits.'
    },
    { title: 'Why your view differs from a colleague’s', description: PERMISSION_NOTE }
  ]
};

export const CLIENTS_GUIDE: InfobarContent = {
  title: 'Clients',
  sections: [
    {
      title: 'What this is',
      description:
        'Every client you have visibility into, with their projects, staff, notes and recent email activity behind each one.'
    },
    {
      title: 'How to add one',
      description:
        'Press "New client". The team you set decides who else can see it, so set it to the team that will actually do the work rather than leaving it on yours by default.'
    },
    { title: 'Why your view differs from a colleague’s', description: PERMISSION_NOTE }
  ]
};

export const PROJECTS_GUIDE: InfobarContent = {
  title: 'Projects',
  sections: [
    {
      title: 'What this is',
      description:
        'Work with a start and an end, grouped under a client, holding its own tasks and milestones.'
    },
    {
      title: 'How to add one',
      description:
        'Press "New project". Choosing a template fills in its standard tasks and milestones immediately, which is the difference between an empty project and one you can start working. Templates are managed in Settings → Project Templates.'
    },
    { title: 'Why your view differs from a colleague’s', description: PERMISSION_NOTE }
  ]
};

export const TEAMS_GUIDE: InfobarContent = {
  title: 'Teams',
  sections: [
    {
      title: 'What this is',
      description:
        'Who is working right now, and how much open work each team is carrying.'
    },
    {
      title: 'What you can do here',
      description:
        'Set your own status — working, on a break, or finished for the day. It is live presence only: nothing is kept as a timesheet, and nobody is scored on it. Clocked hours, if you use them, are in HR → Rotas.'
    },
    {
      title: 'How teams are set',
      description:
        'A team is a plain text label on each person, set in Settings → People & Access. A team appears on this page as soon as one person is given that label, and disappears when nobody has it.'
    }
  ]
};

export const CALENDAR_GUIDE: InfobarContent = {
  title: 'Calendar',
  sections: [
    {
      title: 'What this is',
      description:
        'Meetings, deadlines and approved time off, in one place. It works entirely on its own — no external calendar account is required for it to be useful.'
    },
    {
      title: 'How to add something',
      description:
        'Press "New event". Adding attendees puts it on their calendar too; linking it to a client or project is what makes it appear on that record.'
    },
    {
      title: 'Where the entries come from',
      description:
        'Events created here, task due dates, and leave that has been approved in HR → Time Off. Leave appears automatically once approved; you do not add it twice.'
    }
  ]
};

export const AUTOMATIONS_GUIDE: InfobarContent = {
  title: 'Automations',
  sections: [
    {
      title: 'What this is',
      description:
        'Rules that run without anyone pressing anything: event, condition, action, and a record of every run. Automation here is rule-driven — the AI suggests, rules and people decide.'
    },
    {
      title: 'What you can do here',
      description:
        'Turn a rule on or off, change its settings, and read what it actually did on each run. Every change asks for your authenticator code first, because a rule that sends mail on the firm’s behalf is not a preference.'
    },
    {
      title: 'If something goes wrong',
      description:
        'The kill switch stops every automation at once and is deliberately blunt. Individual failed runs are kept with their error rather than retried silently.'
    }
  ]
};

export const REPORTS_GUIDE: InfobarContent = {
  title: 'Reports',
  sections: [
    {
      title: 'What this is',
      description:
        'Workload, delivery, client health and automation activity across the company, computed live from the same records the rest of the Hub uses.'
    },
    {
      title: 'What you can do here',
      description:
        'Change the period and export what you are looking at. There is no separate reporting database, so a number here and the screen it came from can never disagree.'
    },
    {
      title: 'Who can see it',
      description:
        'Managers and administrators. HR’s own reporting — headcount, turnover, absence — is separate, in HR → HR Reports, because it is about people rather than work.'
    }
  ]
};

export const CHAT_GUIDE: InfobarContent = {
  title: 'Team Chat',
  sections: [
    {
      title: 'What this is',
      description:
        'Direct and group messages between people at the organisation, with file, image and document attachments.'
    },
    {
      title: 'How to start one',
      description:
        'Press "New conversation" and pick who is in it. A group can be named; a direct message takes its name from the other person.'
    },
    {
      title: 'Who can read a conversation',
      description:
        'Only the people in it. This is the one part of the Hub that does not follow role and team at all — being an administrator does not let you read a conversation you are not part of. Messages arrive by polling rather than instantly, which is a known limitation of this version.'
    }
  ]
};

export const EMAIL_GUIDE: InfobarContent = {
  title: 'Email',
  sections: [
    {
      title: 'What this is',
      description:
        'Mail that relates to clients and projects: incoming enquiries detected automatically, and replies sent from the Hub so the exchange stays on the record.'
    },
    {
      title: 'How to reply',
      description:
        'Open an enquiry and press Reply. The message goes out through the connected mailbox and is filed against the client, so the next person to open that client sees it.'
    },
    {
      title: 'If it says the mailbox is not connected',
      description:
        'Nothing can be sent until an administrator connects it in Settings → Connectors. Incoming detection is separate and will already be recording what arrives.'
    }
  ]
};

export const SEARCH_GUIDE: InfobarContent = {
  title: 'Search',
  sections: [
    {
      title: 'What this is',
      description:
        'One query across clients, projects, tasks, people, documents and email activity.'
    },
    {
      title: 'How to use it',
      description:
        'Type at least two characters. People match on the name they have set, the name on their sign-in account, and their email address, so either name finds them.'
    },
    {
      title: 'What it will not return',
      description:
        'Anything you could not open by navigating to it. Search runs inside your permissions rather than alongside them, so it is never a way round them.'
    }
  ]
};

export const FORMA_AI_GUIDE: InfobarContent = {
  title: 'SYRIX AI',
  sections: [
    {
      title: 'What this is',
      description:
        'A research assistant for immigration and country-conditions questions, which can also read Hub records and propose actions against them when you ask it to.'
    },
    {
      title: 'The three modes',
      description:
        'Spark is a single fast pass. Auto is the default and decides for itself how much a question needs. Zenith convenes a panel of specialists, has a chief write from their reports, and has a reviewer check the result against the evidence — slow, and for questions where being wrong matters.'
    },
    {
      title: 'Nothing is kept',
      description:
        'The conversation lives in this browser tab and nowhere else. Starting a new chat wipes the old one irreversibly, and no prompt or answer is written to the database, the logs or error reporting. Closing the tab ends it.'
    },
    {
      title: 'Before it changes anything',
      description:
        'Any action against Hub data is shown to you first as a card with the real, fully rendered parameters — not a summary of what it intends. Nothing happens until you approve that specific card.'
    },
    {
      title: 'Where its answers come from',
      description:
        'Published sources it read at the time of asking, cited beneath the answer. Where retrieval found nothing, it says so rather than answering a rule question from memory — that is exactly when memory is most confident and most out of date.'
    }
  ]
};

export const AI_SETTINGS_GUIDE: InfobarContent = {
  title: 'SYRIX AI settings',
  sections: [
    {
      title: 'What this is',
      description:
        'Your own preferences for the assistant. They apply to you alone — two people on the same team can set these differently.'
    },
    {
      title: 'Answer language',
      description:
        'Changes the language answers are written in, and nothing else. Sources are still read in whatever language they were published in, because that is where the rules actually are.'
    },
    {
      title: 'Hub access',
      description:
        'Switching it off stops the assistant reading your Hub records or proposing any action against them. Web research is unaffected — that reaches nothing belonging to this business, so there is no reason for it to stop.'
    }
  ]
};

export const INTEGRATIONS_GUIDE: InfobarContent = {
  title: 'Integrations',
  sections: [
    {
      title: 'What this is',
      description:
        'Systems this codebase has a purpose-built adapter for, with their connection state and anything that failed. For adding a credential to something generic — an API key or an MCP server — use Connectors instead.'
    },
    {
      title: 'What you can do here',
      description:
        'Turn an integration on or off, name an owner, save its credentials, and run a real round trip to confirm they work. A test that passes means the service actually answered.'
    },
    {
      title: 'When something fails',
      description:
        'A dead integration degrades its feature and never takes the Hub down. Inbound events that could not be processed are kept in the dead-letter list with their error — nothing is silently dropped — and can be resolved once the cause is fixed.'
    }
  ]
};

export const PROJECT_TEMPLATES_GUIDE: InfobarContent = {
  title: 'Project Templates',
  sections: [
    {
      title: 'What this is',
      description:
        'A standard set of tasks and milestones per service line, so a project of a familiar kind starts with its work already in it rather than empty.'
    },
    {
      title: 'How to build one',
      description:
        'Create the template, then add tasks with a due date expressed in days relative to the project start — the real dates are worked out when the template is applied, so one template fits every start date.'
    },
    {
      title: 'How it is used',
      description:
        'Choosing a template when creating a project copies its tasks and milestones in immediately. Editing a template afterwards never changes projects already created from it: those are real tasks people may have started.'
    }
  ]
};

export const SETTINGS_GUIDE: InfobarContent = {
  title: 'Account & Security',
  sections: [
    {
      title: 'What this is',
      description:
        'Your own account: the name the Hub shows for you, how it looks on this device, your authenticator, and the sessions you are signed in on.'
    },
    {
      title: 'The name you set here is the name everyone sees',
      description:
        'It replaces the name from your sign-in account throughout the Hub — the sidebar, the team roster, tasks assigned to you, Team Chat and SYRIX AI. It changes nothing about your permissions or the audit trail, both of which key off your record rather than your name.'
    },
    {
      title: 'If you think someone else has your password',
      description:
        '"Sign out other sessions" ends every session except this one immediately. Your authenticator is separate from your password and is asked for again on anything sensitive.'
    }
  ]
};

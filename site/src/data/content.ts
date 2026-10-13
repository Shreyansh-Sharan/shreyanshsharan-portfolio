// All portfolio content lives here. Edit this file to change what the site shows.
import type { LucideIcon } from 'lucide-react'
import {
  CarFront,
  CircleDot,
  Flag,
  Award,
  Crosshair,
  Database,
  FileDown,
  FlaskConical,
  Goal,
  GraduationCap,
  Layers,
  Presentation,
  Trophy,
  User,
  Warehouse,
  ChartColumn,
  Network,
  PawPrint,
  Wine,
  Boxes,
  ShieldCheck,
  Workflow,
  Hammer,
} from 'lucide-react'

export const profile = {
  name: 'Shreyansh Sharan',
  initials: 'SS',
  headline: 'Solution Architect & Engineering Manager · Data & AI Platforms',
  location: 'India',
  email: 'nitjshreyannshsharan@gmail.com',
  linkedin: 'https://www.linkedin.com/in/shreyanshsharan',
  resumePdf: 'Shreyansh_Sharan_Resume.pdf',
  summary:
    'Solution Architect and Engineering Manager with 8+ years across analytics, data engineering, DevOps and ' +
    'Generative AI, delivering for 30+ enterprise clients in healthcare, beverages, CPG/FMCG, retail, pharma, ' +
    'agrochemicals, aviation, financial services and construction materials. Shipped an ML platform to GA, built an ' +
    'Agent Registry solo after two years of stalled attempts, and delivered a two-phase data governance product for a ' +
    'Fortune 500 US healthcare insurer. DevOps lead and sole company member of the core platform team for the ' +
    "world's largest spirits company, whose DevOps framework serves 1,000–2,000 developers. Quarterly Impact Award " +
    'in all four quarters and seven certifications this year.',
  hobbies: ['Soccer', 'Formula 1', 'Video games', 'Badminton', 'Table tennis'],
}

export interface Stat {
  value: string
  label: string
}

export interface Activity {
  title: string
  detail: string
}

export type TileAction =
  | { kind: 'hub' }
  | { kind: 'route'; to: string; label: string }
  | { kind: 'download'; href: string; label: string }
  | { kind: 'iframe'; url: string; label: string }
  | { kind: 'soon'; label: string }

export type TabId = 'profile' | 'career' | 'showcase' | 'extras'

export interface Tile {
  id: string
  tab: TabId
  title: string
  tagline: string
  org: string
  period: string
  genre: string
  blurb: string
  icon: LucideIcon
  // Two hex colours: [deep, bright]. They drive the tile art and the animated background.
  accent: [string, string]
  // Optional cover image in /public (e.g. generated art). Falls back to the gradient art.
  cover?: string
  // Also listed under another tab.
  alsoIn?: TabId
  action: TileAction
  stats: Stat[]
  activities: Activity[]
  achievements?: string[]
  stack?: string[]
}

export const tiles: Tile[] = [
  {
    id: 'omni-studio',
    tab: 'career',
    title: 'Omni Studio',
    tagline: "Director's Cut",
    org: 'Polestar Analytics · Product',
    period: '2025 – Present',
    genre: 'Data & AI Platform',
    blurb:
      'A five-studio AI data platform on Databricks that takes a client from raw documents to governed ' +
      'models, ML, self-explaining dashboards and agents. Architected and built end to end: front end, back end and APIs.',
    icon: Layers,
    accent: ['#5b21b6', '#22d3ee'],
    action: { kind: 'hub' },
    stats: [
      { value: '5', label: 'Studios' },
      { value: '1', label: 'Page-aware assistant (Omni)' },
      { value: 'MCP', label: 'Server per studio' },
      { value: 'E2E', label: 'Front end · back end · APIs' },
    ],
    activities: [
      {
        title: 'Foundation Studio',
        detail:
          'An AI builder that reads client BRD and source-to-target mapping documents and drafts a governed medallion model (Bronze, Silver, Gold star schema with SCD2), its transformations and deterministic Databricks SQL, with a person approving each stage before a 9-step deploy wizard.',
      },
      {
        title: 'Governance Studio',
        detail:
          'A control plane that scans Databricks jobs, clusters, SQL history and notebooks across 12 collection targets, with column-level lineage, cost and LLM-spend budgets, right-sizing recommendations, access reviews and an immutable audit log.',
      },
      {
        title: 'ML Studio',
        detail:
          'From a business question to a deployed model: problem framing, a sandboxed guided notebook with Optuna tuning, MLflow experiments, champion models, Databricks serving and drift monitoring.',
      },
      {
        title: 'Insights Studio',
        detail:
          'A semantic layer (tables, knowledge graph, glossary, governed metrics, data-quality rules) with AI-built dashboards, "ask why" insights and natural-language-to-SQL over Unity Catalog.',
      },
      {
        title: 'Agent Studio',
        detail:
          'Agents with models, tools and MCP skills that read and write across every studio, plus a live playground and full run traces.',
      },
      {
        title: 'Omni assistant',
        detail:
          'A Ctrl+K assistant that opens anywhere, knows the current screen and engagement, and suggests page-aware prompts.',
      },
    ],
    stack: ['Databricks', 'Unity Catalog', 'MLflow', 'Optuna', 'MCP', 'LLM agents', 'NL-to-SQL', 'Full-stack web'],
  },
  {
    id: 'diageo-devops',
    tab: 'career',
    title: 'Spirits Major',
    tagline: 'The DevOps Saga',
    org: 'Polestar Analytics · DevOps Lead & Solution Architect',
    period: '2023 – Present',
    genre: 'Enterprise DevOps',
    blurb:
      "An enterprise Azure DevOps framework for the world's largest spirits and whisky company, standardising how data workloads are built, tested and released across the business.",
    icon: Wine,
    accent: ['#92400e', '#fbbf24'],
    action: { kind: 'hub' },
    stats: [
      { value: '7', label: 'Business verticals' },
      { value: '1–2K', label: 'Developers on the framework' },
      { value: '<2h', label: 'Release lead time (from ~3 days)' },
      { value: '−60%', label: 'Failed deployments' },
    ],
    activities: [
      {
        title: 'Framework architecture',
        detail:
          'Standardised CI/CD, branching, environment promotion and release governance for data workloads across Databricks, Azure Data Factory and Azure.',
      },
      {
        title: 'Enterprise adoption',
        detail:
          'Rolled out across Supply, People, Legal, Finance, Customer, Consumer and more, used by 1,000–2,000 internal and vendor developers.',
      },
      {
        title: 'Faster, safer releases',
        detail: 'Cut release lead time from about 3 days to under 2 hours and failed deployments by about 60%.',
      },
      {
        title: 'Reusable templates',
        detail:
          'Pipeline templates, quality gates and automated environment set-up cut onboarding a new project from 2 weeks to 2 days.',
      },
      {
        title: 'Turnaround',
        detail:
          'Took over the programme during escalations, stabilised it and delivered on schedule; the engagement grew from a 3-month contract to a multi-year partnership.',
      },
      {
        title: "Inside the client's platform team",
        detail:
          "The company's sole member of the client's DevOps and core platform teams: proposes and builds solutions under their security and change-management processes, with zero violations and zero escalations.",
      },
    ],
    stack: ['Azure DevOps', 'YAML pipelines', 'CI/CD', 'Git branching', 'Databricks', 'Azure Data Factory'],
  },
  {
    id: 'platform-suite',
    tab: 'career',
    title: 'Platform Suite',
    tagline: 'Four Products, One Bar',
    org: 'Polestar Analytics · Solution Architect & Engineering Manager',
    period: '2025 – Present',
    genre: 'Product Engineering',
    blurb:
      "Architect and engineering manager for the company's platform products: an ML platform shipped to GA, an Agent Registry " +
      'built solo after two years of stalled attempts, the User Management System every product runs on, and a self-service ' +
      'Insight Portal sold to clients as POCs. Every committed timeline met.',
    icon: Boxes,
    accent: ['#1e3a8a', '#60a5fa'],
    action: { kind: 'hub' },
    stats: [
      { value: 'GA', label: 'MLOrion ML platform' },
      { value: 'Solo', label: 'Agent Registry, end to end' },
      { value: '100%', label: 'Timelines met' },
      { value: 'Weekly', label: '1:1s with every developer' },
    ],
    activities: [
      {
        title: 'MLOrion',
        detail: 'A reusable ML platform taken to general availability on plan and running real workloads; onboarded the data science team.',
      },
      {
        title: 'Agent Registry',
        detail:
          'Stuck in planning for two years; built solo and delivered on schedule. Every domain and platform team now uses it to add and govern LLMs, agents, tokens and agentic systems.',
      },
      {
        title: 'User Management System',
        detail: 'The enterprise-wide identity and access layer adopted by every product under development, without rework.',
      },
      {
        title: 'Insight Portal',
        detail:
          'Self-service BI that bypasses the reporting layer by connecting directly to Power BI semantic models and data sources: POCs for several clients and an internal CRM Insight Portal.',
      },
      {
        title: 'Engineering management',
        detail:
          'Weekly 1:1s with every developer, quality reviews before anything reaches production, and technical interviews for data engineering, architecture and DevOps roles.',
      },
    ],
    stack: ['Databricks', 'Azure', 'MLflow', 'LLM agents', 'Power BI semantic models', 'FastAPI'],
  },
  {
    id: 'connected-governance',
    tab: 'career',
    title: 'Connected Governance',
    tagline: 'Lineage to Lake Insight',
    org: 'Polestar Analytics · Solution Architect',
    period: '2024 – Present',
    genre: 'Data Governance',
    blurb:
      'A productised lineage, FinOps and audit-balance-control platform for a Fortune 500 US healthcare insurer: won through a ' +
      'presales lineage demo, then delivered on time in two phases, from estate-wide Databricks lineage to the full Lake Insight platform.',
    icon: ShieldCheck,
    accent: ['#0f766e', '#5eead4'],
    action: { kind: 'hub' },
    stats: [
      { value: '2', label: 'Phases sold' },
      { value: 'On time', label: 'Both phases' },
      { value: '3', label: 'Pillars: lineage · FinOps · ABC' },
    ],
    activities: [
      { title: 'Presales win', detail: 'An API-driven lineage demo materially helped win the engagement.' },
      { title: 'Phase 1 · Lineage', detail: "Lineage across the client's entire Databricks estate." },
      {
        title: 'Phase 2 · Lake Insight',
        detail: 'The client bought a second phase after the first: lineage, FinOps cost visibility and audit-balance-control in one platform.',
      },
      { title: 'Reusable product', detail: 'Packaged as a governance accelerator ready for other clients; knowledge transfer delivered to the client team.' },
    ],
    stack: ['Databricks', 'Unity Catalog', 'Lineage APIs', 'FinOps', 'Audit-balance-control'],
  },
  {
    id: 'datanexus',
    tab: 'career',
    title: 'Datanexus',
    tagline: 'Platform Modernization',
    org: 'Polestar Analytics · Lead Architect, 1Platform',
    period: '2023 – 2025',
    genre: 'Data Platform',
    blurb:
      'Drove the 1Platform portfolio: the Datanexus platform on both Microsoft Fabric and Databricks, Transformation V2 on ' +
      'microservices, reusable ingestion and lineage frameworks, and the Agenthood architecture with Agentbricks on Databricks.',
    icon: Workflow,
    accent: ['#7c2d12', '#fdba74'],
    action: { kind: 'hub' },
    stats: [
      { value: '≈50×', label: 'Faster ingestion (300+ min → 6 min)' },
      { value: '2', label: 'Engines: Fabric · Databricks' },
      { value: '4', label: 'Reusable accelerators' },
      { value: '0', label: 'Critical production defects' },
    ],
    activities: [
      {
        title: 'Datanexus & Transformation V2',
        detail: 'Built Datanexus for Fabric and Databricks and introduced microservices for Transformation V2, with LLDs designed to shrink the defect surface.',
      },
      {
        title: 'Ingestion at speed',
        detail:
          'Re-architected ingestion for a global footwear and fashion retailer: 500 files in 6 minutes instead of 300+, about 50× faster, ending repeated SLA breaches.',
      },
      {
        title: 'Accelerators',
        detail:
          'Lineage API, ingestion framework, Power BI DevOps automation (reports and data moved between workspaces with compliance controls) and modular integration flows; integrated the platform with MDM and OCR.',
      },
      { title: 'Agenthood', detail: 'Proposed the architecture and led the LLD for Agenthood, and built Agentbricks components on Databricks.' },
      { title: 'Backend lead', detail: 'Led the 1Platform backend team on Microsoft Fabric and FastAPI; ran Databricks, MLOps, data science and streaming trainings.' },
    ],
    stack: ['Microsoft Fabric', 'Databricks', 'FastAPI', 'Microservices', 'Power BI', 'LLM agents'],
  },
  {
    id: 'architect-mode',
    tab: 'career',
    title: 'Architect Mode',
    tagline: 'Pre-Sales & Migrations',
    org: 'Polestar Analytics · Solution Architect',
    period: '2025 – Present',
    genre: 'Strategy',
    blurb:
      'Leading pre-sales and solution design across CPG, FMCG and Financial Services, and writing target architectures for data, infrastructure and cloud migration programmes.',
    icon: Presentation,
    accent: ['#9f1239', '#fb7185'],
    action: { kind: 'hub' },
    stats: [
      { value: '20+', label: 'Pre-sales opportunities' },
      { value: '8', label: 'Client wins' },
      { value: '3', label: 'Domains: CPG · FMCG · FS' },
    ],
    activities: [
      {
        title: 'Pre-sales leadership',
        detail: 'Discovery calls, solution architecture, effort estimates and demos for 20+ opportunities, contributing to 8 client wins.',
      },
      {
        title: 'Target architectures',
        detail: 'Authored architectures for data engineering, infrastructure and cloud migration programmes.',
      },
      {
        title: 'Migrations',
        detail: 'Moved on-premises systems and legacy BI to Azure and the Databricks Lakehouse.',
      },
      {
        title: 'Presales demos',
        detail:
          'A reusable lineage demo helped win a Fortune 500 US healthcare insurer; demos and proposals for wealth management, confectionery, automotive aftermarket, pharma services and retail prospects.',
      },
      {
        title: 'Partner audits',
        detail: 'Led documentation for the Microsoft Analytics Specialization audit to a gap-free review, and the infrastructure and database migration audit.',
      },
    ],
    stack: ['Solution architecture', 'Azure', 'Databricks Lakehouse', 'Estimation', 'Demos'],
  },
  {
    id: 'lakehouse-logistics',
    tab: 'career',
    title: 'Lakehouse Logistics',
    tagline: 'Inventory Intelligence',
    org: 'Polestar Analytics · Data Engineer',
    period: '2024 – 2025',
    genre: 'Data Engineering',
    blurb:
      "An inventory intelligence platform for one of the world's largest fertilizer companies: SAP data into a Databricks medallion Lakehouse feeding ML stock models and dashboards for inventory leaders.",
    icon: Warehouse,
    accent: ['#166534', '#a3e635'],
    action: { kind: 'hub' },
    stats: [
      { value: '−18%', label: 'Stock-outs' },
      { value: '−12%', label: 'Excess inventory holding' },
      { value: '40+', label: 'ADF pipelines' },
      { value: '50M+', label: 'Rows processed daily' },
    ],
    activities: [
      {
        title: 'SAP to Lakehouse',
        detail: 'Ingested SAP (ECC/S4) data through Azure Data Factory into a Databricks Bronze/Silver/Gold Lakehouse.',
      },
      {
        title: 'ML stock rebalancing',
        detail: 'ML-driven rebalancing used by inventory managers and leadership: about 18% fewer stock-outs and 12% less excess inventory.',
      },
      {
        title: 'Pipelines at scale',
        detail: '40+ parameterised ADF pipelines and PySpark jobs processing 50M+ rows a day, with incremental loads and data-quality checks.',
      },
      {
        title: 'More clients',
        detail:
          "Data engineering for Financial Services and CPG clients and one of the world's largest construction companies; Spark tuning cut job run time by about 35%.",
      },
    ],
    stack: ['Azure Data Factory', 'Databricks', 'PySpark', 'Delta Lake', 'SAP', 'ML'],
  },
  {
    id: 'qlik-legends',
    tab: 'career',
    title: 'Qlik Legends',
    tagline: '30 Clients Campaign',
    org: 'Polestar Analytics · Qlik & Azure Solution Architect',
    period: '2021 – 2024',
    genre: 'Business Intelligence',
    blurb:
      'Delivered Qlik and Azure solutions for 25–30 clients in agrochemicals, aviation, biotech, automotive, fintech, cement, ' +
      'fuel retail and logistics automation, as developer, solution architect and platform administrator.',
    icon: ChartColumn,
    accent: ['#115e59', '#2dd4bf'],
    action: { kind: 'hub' },
    stats: [
      { value: '25–30', label: 'Clients' },
      { value: '150+', label: 'Dashboards' },
      { value: '2,000+', label: 'Users administered' },
      { value: '−40%', label: 'Reload times' },
    ],
    activities: [
      {
        title: 'Dashboards',
        detail: '150+ Qlik Sense and QlikView dashboards across sales, finance, supply chain and operations.',
      },
      {
        title: 'Performance',
        detail: 'Optimised data models to cut reload times by about 40%.',
      },
      {
        title: 'Platform administration',
        detail: 'Ran multi-node Qlik Sense for 2,000+ users: security rules, streams, licences, scheduling and upgrades.',
      },
      {
        title: 'Migrations & mentoring',
        detail: 'Led QlikView to Qlik Sense migrations and mentored junior developers.',
      },
      {
        title: 'Long engagements',
        detail:
          "A Qlik Sense engagement with one of the world's largest agrochemical companies grew from a 3-month contract to 1.8 years and into a full BI, data platform and governance SOW; merged two regional estates (48 extractors and apps) in one weekend without an incident.",
      },
      {
        title: 'Risks caught early',
        detail: "Flagged a Qlik version issue before anyone else on a national airline's programme, bringing UAT forward; rebalanced a global automaker's Qlik consumer nodes.",
      },
      {
        title: 'Azure & DevOps',
        detail:
          'Azure architectures and CI/CD for Data Factory and Synapse, reusable Terraform templates and Docker hosting for fuel-retail, logistics and SaaS clients; trained the first DevOps team and a graduate batch.',
      },
    ],
    stack: ['Qlik Sense', 'QlikView', 'QMC / QRS', 'NPrinting', 'Azure', 'Azure DevOps', 'Terraform'],
  },
  {
    id: 'wipro-origins',
    tab: 'career',
    title: 'Wipro',
    tagline: 'Origins',
    org: 'Wipro Limited · Pharma analytics',
    period: '2018 – 2021',
    genre: 'Analytics & Automation',
    blurb:
      'Two chapters with two pharmaceutical clients: building sales and pharmacy dashboards, then architecting and automating the whole Qlik delivery lifecycle.',
    icon: FlaskConical,
    accent: ['#1e40af', '#38bdf8'],
    action: { kind: 'hub' },
    stats: [
      { value: '2', label: 'Pharma clients' },
      { value: '2d → 30m', label: 'Provisioning time' },
      { value: '−80%', label: 'Manual admin effort' },
      { value: '3', label: 'Awards' },
    ],
    activities: [
      {
        title: 'Chapter 1 · Qlik Developer (2018–2020)',
        detail: 'Built sales, insights and pharmacy performance dashboards for sales leadership and field teams: 50+ dashboards and reports.',
      },
      {
        title: 'Chapter 2 · Qlik Solution Architect & Automation (2020–2021)',
        detail:
          'Automated project creation, streams, dashboard publishing and access management with Python and Selenium, turning a 2-day process into about 30 minutes.',
      },
      {
        title: 'Platform design',
        detail: "Designed the solution architecture and governance model for the client's Qlik platform.",
      },
    ],
    achievements: ['Most Innovative Award', 'Key Player, Pharmaceutical Vertical', 'Best New Recruit 2018'],
    stack: ['Qlik Sense', 'Python', 'Selenium', 'Automation'],
  },
  {
    id: 'nit-academy',
    tab: 'career',
    title: 'NIT Jalandhar',
    tagline: 'Academy',
    org: 'Dr. B. R. Ambedkar National Institute of Technology',
    period: '2014 – 2018',
    genre: 'Education',
    blurb: 'Bachelor of Technology (B.Tech) from Dr. B. R. Ambedkar National Institute of Technology, Jalandhar, Punjab.',
    icon: GraduationCap,
    accent: ['#3730a3', '#a5b4fc'],
    action: { kind: 'hub' },
    stats: [{ value: 'B.Tech', label: 'Degree' }],
    activities: [{ title: 'Bachelor of Technology', detail: 'NIT Jalandhar, Punjab, India.' }],
  },
  {
    id: 'footballiq',
    tab: 'showcase',
    title: 'FootballIQ',
    tagline: 'Every match, understood live',
    org: 'Independent · Product',
    period: '2025 – Present',
    genre: 'Live Football Analytics',
    blurb:
      'A live football analytics platform that turns event and 30 Hz tracking feeds into real-time, minute-by-minute ' +
      'insight. Calibrated models and an AI strategist that cites its evidence power five synchronised views on one ' +
      'clock: live match, pre-match intelligence, a tactical workbench, predictive coaching and a plain-language strategist. ' +
      'Built on Microsoft Fabric and Foundry with StatsBomb events and PFF tracking data.',
    icon: Goal,
    accent: ['#065f46', '#34d399'],
    cover: undefined,
    action: { kind: 'iframe', url: 'https://footballiq.shreyanshsharan.com', label: 'Open FootballIQ' },
    stats: [
      { value: '30 Hz', label: 'Tracking data' },
      { value: '5', label: 'Synchronised views' },
      { value: '1', label: 'Clock across every view' },
      { value: 'AI', label: 'Strategist that cites evidence' },
    ],
    activities: [
      { title: 'Live Match', detail: 'Real-time event and 30 Hz tracking, analysed minute by minute as the match unfolds.' },
      { title: 'Pre-match Intelligence', detail: 'Opponent and matchup scouting from calibrated models before kickoff.' },
      { title: 'Tactical Workbench', detail: 'Compare windows of a match side by side to see how phases of play changed.' },
      { title: 'Predictive & Coaching', detail: 'Model-driven predictions and coaching cues, with an AI strategist you query in plain language.' },
    ],
    stack: ['Microsoft Fabric', 'Microsoft Foundry', 'StatsBomb', 'PFF tracking', 'Calibrated models', 'LLM agents'],
  },
  {
    id: 'arena',
    tab: 'extras',
    title: 'Dunes Arena',
    tagline: 'Multiplayer FPS',
    org: 'three.js · Ball physics · Online 1v1',
    period: 'Play now',
    genre: 'Shooter',
    blurb:
      'A lightweight browser shooter on six original maps, including three classic-style arenas (Sandstorm, Villa and Bazaar). Five weapons from sidearm to scoped sniper, right-click aiming, AI bots or friends by invite code, plus dash, double jump, overshield and pulse scan.',
    icon: Crosshair,
    accent: ['#9a3412', '#fdba74'],
    action: { kind: 'route', to: '#/arena', label: 'Play' },
    stats: [],
    activities: [],
  },
  {
    id: 'cricket',
    tab: 'extras',
    title: 'Cricket',
    tagline: 'Realistic Cricket',
    org: 'three.js · Ball physics · Online 1v1',
    period: 'Play now',
    genre: 'Sports',
    blurb:
      'T20, T10, a 5-over Blitz or a Super Over between fictional sides, from over the batter\'s shoulder or the classic broadcast view. See where the ball will pitch, hold a direction and time your shot as the ring closes; place a marker on the length bands and hit the green on the run-up meter. Swing, seam and spin off green, flat or dusty pitches, diving fielders, run outs, DRS ball-tracking and replays. Practice nets, the CPU or a friend online.',
    cover: 'cricket/keyart.webp',
    icon: CircleDot,
    accent: ['#14532d', '#86efac'],
    action: { kind: 'route', to: '#/cricket', label: 'Play' },
    stats: [],
    activities: [],
  },
  {
    id: 'volt-riot',
    tab: 'extras',
    title: 'VOLT RIOT',
    tagline: 'Combat Racer',
    org: 'Three.js · Custom 3D cars & props',
    period: 'Play now',
    genre: 'Racing',
    blurb:
      'A neon street racer with weapons. Twelve colour-coded power-ups, a three-slot bay, ten segments of health, drift handling, seven AI rivals, four circuits from a storm-drain river to a seaside pier, a Combat Points series and a Dust Bowl deathmatch arena. Win fans, earn Lights.',
    icon: CarFront,
    accent: ['#831843', '#f0abfc'],
    action: { kind: 'route', to: '#/racer', label: 'Race' },
    stats: [],
    activities: [],
  },
  {
    id: 'bogey-brawl',
    tab: 'extras',
    title: 'BOGEY BRAWL',
    tagline: 'Battle Golf',
    org: 'Three.js · Custom 3D golfer & props',
    period: 'Play now',
    genre: 'Sports · Party',
    blurb:
      'Everyone tees off at once on four holes, from a lakeside par 4 to a desert canyon, a frozen fjord and a volcano island at night. First ball in the cup scores the most, but golf carts, rockets, orbital lasers, tornadoes and banana peels mean nobody gets a quiet putt.',
    icon: Flag,
    accent: ['#14532d', '#bef264'],
    action: { kind: 'route', to: '#/golf', label: 'Tee off' },
    stats: [],
    activities: [],
  },
  {
    id: 'plush-panic',
    tab: 'extras',
    title: 'PLUSH PANIC',
    tagline: 'Party Brawler',
    org: 'Three.js · Rapier physics · Custom rigged plush toys',
    period: 'Play now',
    genre: 'Party · Online',
    blurb:
      'Squishy plush toys meet in a cosy attic, then play a Show of short, chaotic rounds where the field shrinks until one toy wears the crown. Trace a biscuit without cracking it, freeze when the music box stops, and knock rivals off a shrinking stool, all while flicking crumbs at your friends.',
    cover: 'plush/keyart.webp',
    icon: PawPrint,
    accent: ['#7c2d12', '#fbbf24'],
    action: { kind: 'route', to: '#/plush', label: 'Play now' },
    stats: [],
    activities: [],
  },
  {
    id: 'neon-siege',
    tab: 'extras',
    title: 'NEON SIEGE',
    tagline: 'Arena Shooter',
    org: 'Three.js · Deterministic sim · Twin-stick',
    period: 'Play now',
    genre: 'Shooter · Online',
    blurb:
      'A top-down cyberpunk arena shooter: six heroes with their own blasters and supers, 3v3 Team Takedown and Core Control on three neon maps, and a solo Grid Royale against sixteen bots on a shrinking grid with loot crates. Coins, gear merging, palettes and daily jobs are saved in your browser.',
    cover: 'siege/keyart.webp',
    icon: Crosshair,
    accent: ['#4c1d95', '#f0abfc'],
    action: { kind: 'route', to: '#/siege', label: 'Play now' },
    stats: [],
    activities: [],
  },
  {
    id: 'lawn-wars',
    tab: 'extras',
    title: 'LAWN WARS',
    tagline: 'Family Brawler',
    org: 'Three.js · First-person · Destructible houses',
    period: 'Play now',
    genre: 'Brawler · Online',
    blurb:
      'A first-person 4v4 family-vs-family suburban brawler: sixty seconds to barricade doors and lay traps, then eight minutes to raid the rival house with garden tools and thrown junk, breaking their tagged valuables for points. Six original heroes with ultimates, ladders to the balcony, two streets (a sunny cul-de-sac and a snowy motor lodge) by day or night, Brawl and a co-op Robot Invasion. Coins, hero levels, perks and house customisation are saved in your browser.',
    cover: 'lawn/keyart.webp',
    icon: Hammer,
    accent: ['#2f7d32', '#ffd93b'],
    action: { kind: 'route', to: '#/lawn', label: 'Play now' },
    stats: [],
    activities: [],
  },
  {
    id: 'trophies',
    tab: 'extras',
    alsoIn: 'profile',
    title: 'Trophies',
    tagline: 'Certifications & Awards',
    org: 'Anthropic · Databricks · Microsoft · Qlik · Wipro',
    period: '11 earned',
    genre: 'Collection',
    blurb: 'Every certification and award, collected as trophies.',
    icon: Trophy,
    accent: ['#a16207', '#fde047'],
    action: { kind: 'route', to: '#/trophies', label: 'View trophies' },
    stats: [],
    activities: [],
  },
  {
    id: 'skill-tree',
    tab: 'extras',
    alsoIn: 'profile',
    title: 'Skill Tree',
    tagline: 'Loadout',
    org: 'Data · DevOps · GenAI · ML · BI',
    period: '6 branches',
    genre: 'Skills',
    blurb: 'The full loadout: data and cloud, DevOps, Generative AI, ML, BI and languages.',
    icon: Network,
    accent: ['#075985', '#7dd3fc'],
    action: { kind: 'route', to: '#/skills', label: 'Open skill tree' },
    stats: [],
    activities: [],
  },
  {
    id: 'profile',
    tab: 'profile',
    alsoIn: 'career',
    title: 'Player Profile',
    tagline: 'About & Contact',
    org: 'Shreyansh Sharan',
    period: 'Online',
    genre: 'Profile',
    blurb:
      'Solution Architect with 8+ years across analytics, data engineering, DevOps and Generative AI, delivering for 30+ enterprise clients. ' +
      'Meet the player: an interactive 3D avatar, plus summary, education, hobbies and how to get in touch.',
    cover: 'profile/poster.jpg',
    icon: User,
    accent: ['#334155', '#94a3b8'],
    action: { kind: 'route', to: '#/profile', label: 'View profile' },
    stats: [],
    activities: [],
  },
  {
    id: 'resume',
    tab: 'extras',
    alsoIn: 'profile',
    title: 'Resume',
    tagline: 'Download PDF',
    org: '2 pages',
    period: 'PDF',
    genre: 'Document',
    blurb: 'The full resume as a PDF, or read it as a plain page with Quick View.',
    icon: FileDown,
    accent: ['#475569', '#e2e8f0'],
    action: { kind: 'download', href: 'Shreyansh_Sharan_Resume.pdf', label: 'Download PDF' },
    stats: [],
    activities: [],
  },
  {
    id: 'sports-complex',
    tab: 'extras',
    title: 'Sports Complex',
    tagline: 'Play now',
    org: 'F1 · Soccer · Badminton · Table tennis',
    period: '3 venues',
    genre: '3D World',
    blurb: 'A small 3D sports complex to explore: an F1 track for experience, a stadium for achievements and a rally hall for skills.',
    icon: Flag,
    accent: ['#991b1b', '#f97316'],
    action: { kind: 'route', to: '#/sports', label: 'Enter' },
    stats: [],
    activities: [],
  },
]

export type TrophyTier = 'platinum' | 'gold' | 'silver' | 'bronze'

export interface TrophyItem {
  name: string
  issuer: string
  tier: TrophyTier
  kind: 'Certification' | 'Award'
  icon: LucideIcon
}

export const trophies: TrophyItem[] = [
  { name: 'Claude Certified Solutions Architect', issuer: 'Anthropic', tier: 'platinum', kind: 'Certification', icon: Award },
  { name: 'Azure Solutions Architect Expert', issuer: 'Microsoft', tier: 'platinum', kind: 'Certification', icon: Award },
  { name: 'Azure DevOps Engineer Expert', issuer: 'Microsoft', tier: 'platinum', kind: 'Certification', icon: Award },
  { name: 'Databricks Certified Data Engineer Professional', issuer: 'Databricks', tier: 'gold', kind: 'Certification', icon: Database },
  { name: 'Databricks Certified Generative AI Engineer Associate', issuer: 'Databricks', tier: 'gold', kind: 'Certification', icon: Award },
  { name: 'Databricks Solutions Architect', issuer: 'Databricks', tier: 'gold', kind: 'Certification', icon: Award },
  { name: 'Fabric Analytics Engineer Associate', issuer: 'Microsoft', tier: 'gold', kind: 'Certification', icon: Award },
  { name: 'Azure AI Engineer Associate', issuer: 'Microsoft', tier: 'gold', kind: 'Certification', icon: Award },
  { name: 'Azure Administrator Associate', issuer: 'Microsoft', tier: 'silver', kind: 'Certification', icon: Award },
  { name: 'Qlik Certified Solution Architect', issuer: 'Qlik', tier: 'silver', kind: 'Certification', icon: Award },
  { name: 'Qlik Certified Developer', issuer: 'Qlik', tier: 'silver', kind: 'Certification', icon: Award },
  { name: 'Azure, Data & AI Fundamentals', issuer: 'Microsoft', tier: 'bronze', kind: 'Certification', icon: Award },
  { name: 'Quarterly Impact Award · all four quarters (FY25–26)', issuer: 'Polestar Analytics', tier: 'platinum', kind: 'Award', icon: Trophy },
  { name: 'Above & Beyond Award · every quarter (FY24–25)', issuer: 'Polestar Analytics', tier: 'gold', kind: 'Award', icon: Trophy },
  { name: 'Recognised by the CEO and CTO', issuer: 'Polestar Analytics', tier: 'gold', kind: 'Award', icon: Trophy },
  { name: 'Most Innovative Award', issuer: 'Wipro', tier: 'gold', kind: 'Award', icon: Trophy },
  { name: 'Key Player, Pharmaceutical Vertical', issuer: 'Wipro', tier: 'silver', kind: 'Award', icon: Trophy },
  { name: 'Best New Recruit 2018', issuer: 'Wipro', tier: 'bronze', kind: 'Award', icon: Trophy },
]

export const skillTree: { branch: string; skills: string[] }[] = [
  {
    branch: 'Data & Cloud',
    skills: ['Databricks Lakehouse', 'Unity Catalog', 'Delta Lake', 'PySpark', 'Microsoft Fabric', 'Azure Data Factory', 'ADLS Gen2', 'Azure Synapse', 'SAP integration'],
  },
  {
    branch: 'DevOps',
    skills: ['Azure DevOps', 'YAML pipelines', 'CI/CD', 'Git branching strategy', 'Release governance', 'Environment promotion', 'Terraform', 'Docker', 'Power BI DevOps'],
  },
  {
    branch: 'Generative AI',
    skills: ['Claude', 'LLM agents', 'Model Context Protocol', 'Tool calling', 'RAG', 'NL-to-SQL', 'Databricks Mosaic AI'],
  },
  { branch: 'Machine Learning', skills: ['Feature engineering', 'scikit-learn', 'Optuna', 'MLflow', 'Forecasting', 'Recommenders'] },
  { branch: 'BI & Analytics', skills: ['Qlik Sense', 'QlikView', 'Qlik administration', 'Power BI', 'Semantic layers'] },
  { branch: 'Languages & Apps', skills: ['Python', 'SQL', 'Spark SQL', 'FastAPI', 'Microservices', 'REST APIs', 'Full-stack web', 'Selenium'] },
  { branch: 'Leadership', skills: ['Engineering management', 'Weekly 1:1s', 'Technical interviews', 'Presales', 'Training & enablement', 'Partner audits'] },
]

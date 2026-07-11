# G.O.D.S. Disease Knowledge and Public Advice System

## Specification Addendum v1.0

---

# 1. Core Model

The platform must keep the following entities separate:

```text
Pathogen
   ↓ causes
Disease
   ↓ may produce
Outbreak / Health Event
   ↓ has
Location-specific official advice
```

Example:

```text
Pathogen: Measles virus
Disease: Measles
Event: Measles outbreak in South Yorkshire
Global advice: WHO
European context: ECDC
UK advice: UKHSA / NHS
Local advice: NHS South Yorkshire / local authority, where available
```

An outbreak report must not contain its own permanently copied advice. It links to a disease record and a versioned set of jurisdiction-specific guidance.

---

# 2. Advice Hierarchy

Advice should be selected using this order:

```text
1. Local health authority
2. National health authority
3. Regional authority
4. WHO global guidance
5. G.O.D.S. neutral fallback
```

For a user in Sheffield viewing an event in England:

```text
Primary public advice: NHS / UKHSA
Additional outbreak advice: relevant local health protection authority
Regional context: ECDC where relevant
Global background: WHO
```

For a user in Britain viewing an outbreak in Brazil:

```text
What the affected population should do:
    Brazilian Ministry of Health

What a UK traveller should do:
    UKHSA / NHS / official UK travel-health guidance

Global disease information:
    WHO

Regional outbreak context:
    PAHO
```

The platform must therefore distinguish:

```ts
type AdvicePerspective =
  | "affected_population"
  | "viewer"
  | "traveller"
  | "healthcare_worker"
  | "carer"
  | "school_or_childcare"
  | "employer"
  | "event_organiser"
  | "animal_handler"
  | "general_public";
```

---

# 3. Initial Authoritative Sources

## Global

* World Health Organization
* WHO regional offices
* WHO Disease Outbreak News
* WHO fact sheets
* WHO health topics
* WHO travel guidance where available

WHO maintains global health-topic and fact-sheet catalogues covering diseases, conditions, prevention and public-health information.

## United Kingdom

The UK layer must not be treated as one monolithic source.

```text
England:
    NHS England-facing public information
    UKHSA public-health and outbreak guidance

Scotland:
    NHS inform
    Public Health Scotland

Wales:
    NHS 111 Wales
    Public Health Wales

Northern Ireland:
    nidirect
    Public Health Agency Northern Ireland
```

NHS provides a Conditions A–Z and broader Health A–Z covering symptoms, treatments and when to seek help.

## Europe

* ECDC
* European Commission health authorities
* National public-health agencies
* National health services

ECDC maintains infectious-disease topics and provides scientific advice, risk assessments, surveillance data and outbreak material for Europe.

## Other regions

```text
Africa:
    Africa CDC
    WHO AFRO
    National ministries of health

Americas:
    PAHO
    National ministries and health agencies
    CDC only for United States-specific advice

Eastern Mediterranean:
    WHO EMRO
    National ministries of health

South-East Asia:
    WHO SEARO
    National ministries of health

Western Pacific:
    WHO WPRO
    National ministries of health
```

CDC content may be stored, but tagged:

```json
{
  "jurisdiction": "US",
  "authority": "CDC",
  "appliesTo": ["US residents", "US healthcare systems", "US travellers"],
  "isGlobalDefault": false
}
```

---

# 4. Disease Catalogue Scope

The catalogue should initially cover infectious diseases and outbreak-relevant conditions rather than every medical condition in existence.

## V1 groups

```text
Respiratory infections
Vaccine-preventable diseases
Viral haemorrhagic fevers
Vector-borne diseases
Foodborne diseases
Waterborne diseases
Zoonotic diseases
Sexually transmitted infections
Bloodborne infections
Healthcare-associated infections
Antimicrobial-resistant infections
Childhood infectious diseases
Neglected tropical diseases
Fungal infections
Parasitic infections
Prion diseases
Unknown or novel disease clusters
```

## Example initial diseases

```text
COVID-19
Influenza
Avian influenza
Swine influenza
Respiratory syncytial virus
MERS
SARS
Measles
Mumps
Rubella
Polio
Diphtheria
Pertussis
Chickenpox
Mpox
Ebola disease
Marburg virus disease
Lassa fever
Crimean-Congo haemorrhagic fever
Dengue
Yellow fever
Chikungunya
Zika virus disease
West Nile virus disease
Japanese encephalitis
Malaria
Cholera
Typhoid fever
Shigellosis
Salmonellosis
Campylobacteriosis
Listeriosis
Norovirus
Hepatitis A
Hepatitis B
Hepatitis C
Hepatitis E
HIV infection
Tuberculosis
Meningococcal disease
Pneumococcal disease
Legionnaires’ disease
Leptospirosis
Lyme disease
Rabies
Anthrax
Plague
Nipah virus disease
Hendra virus disease
Q fever
Tularemia
Botulism
Tetanus
Rift Valley fever
Schistosomiasis
Leishmaniasis
Chagas disease
African trypanosomiasis
Cryptosporidiosis
Candida auris infection
Invasive group A streptococcal disease
Clostridioides difficile infection
MRSA infection
Unknown acute respiratory cluster
Unknown neurological syndrome
Unknown haemorrhagic-fever cluster
```

The seed list should be generated from WHO, ECDC and relevant national notifiable-disease catalogues—not manually treated as complete. England’s notifiable-disease system, for example, maintains an official list of infections that healthcare professionals must report to UKHSA.

---

# 5. Disease Database Schema

## 5.1 `diseases`

```sql
create table diseases (
  id uuid primary key,
  public_id varchar(30) unique not null,
  slug varchar(180) unique not null,

  canonical_name varchar(250) not null,
  short_name varchar(120),
  scientific_name varchar(250),

  disease_type varchar(50) not null,
  disease_family varchar(100),
  primary_pathogen_id uuid references pathogens(id),

  plain_summary text,
  clinical_summary text,

  incubation_min_days numeric,
  incubation_max_days numeric,

  infectious_period_summary text,
  transmission_summary text,
  transmission_modes text[] not null default '{}',

  usual_severity varchar(30),
  preventable_by_vaccine boolean,
  vaccine_available boolean,
  treatment_available boolean,

  zoonotic boolean,
  vector_borne boolean,
  foodborne boolean,
  waterborne boolean,
  healthcare_associated boolean,

  notifiable_somewhere boolean not null default false,
  active boolean not null default true,

  content_status varchar(30) not null default 'draft',
  reviewed_at timestamptz,
  review_due_at timestamptz,

  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

## 5.2 `disease_names`

Stores names in different countries and languages.

```sql
create table disease_names (
  id uuid primary key,
  disease_id uuid not null references diseases(id),

  name text not null,
  normalised_name text not null,
  name_type varchar(30) not null,
  language_code varchar(20),
  country_code char(2),

  source_id uuid references health_sources(id),
  preferred boolean not null default false,

  created_at timestamptz not null,

  unique (
    disease_id,
    normalised_name,
    language_code,
    country_code
  )
);
```

Name types:

```text
canonical
common
historic
scientific
abbreviation
former_name
local_name
misspelling
source_alias
```

This permits differences such as:

```text
mpox
monkeypox
MPOX
viruela símica
variole simienne
```

---

# 6. Disease Classification

## 6.1 Transmission modes

```ts
type TransmissionMode =
  | "airborne"
  | "respiratory_droplet"
  | "direct_contact"
  | "indirect_contact"
  | "faecal_oral"
  | "foodborne"
  | "waterborne"
  | "bloodborne"
  | "sexual"
  | "vertical"
  | "vector_borne"
  | "animal_contact"
  | "environmental"
  | "healthcare_associated"
  | "unknown";
```

## 6.2 Population-risk tags

```text
young_children
older_people
pregnant_people
immunocompromised_people
healthcare_workers
laboratory_workers
animal_handlers
travellers
refugees_and_displaced_people
people_with_chronic_conditions
unvaccinated_people
institutional_settings
general_population
```

These are tags used to select appropriate official guidance. They must not be used to calculate personal medical risk.

---

# 7. Advice Content Model

Advice must not be stored as one blob.

## 7.1 `disease_advice_documents`

Represents an official source page or document.

```sql
create table disease_advice_documents (
  id uuid primary key,

  disease_id uuid references diseases(id),
  pathogen_id uuid references pathogens(id),
  event_id uuid references health_events(id),

  source_id uuid not null references health_sources(id),

  external_id text,
  canonical_url text not null,
  title text not null,

  jurisdiction_type varchar(30) not null,
  country_code char(2),
  subdivision_code varchar(100),
  region_code varchar(30),

  audience text[] not null default '{}',
  perspectives text[] not null default '{}',

  language_code varchar(20) not null,
  advice_type varchar(50) not null,

  published_at timestamptz,
  source_updated_at timestamptz,
  fetched_at timestamptz not null,

  valid_from timestamptz,
  valid_until timestamptz,

  content_hash char(64) not null,
  raw_storage_key text,

  status varchar(30) not null,
  supersedes_id uuid references disease_advice_documents(id),

  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

Jurisdiction types:

```text
global
who_region
continent
multi_country
country
nation
state_or_province
local_authority
health_district
unknown
```

Advice types:

```text
public_overview
symptoms
prevention
when_to_seek_help
emergency_warning_signs
testing
isolation
exclusion
vaccination
treatment_overview
travel
pregnancy
children
schools
workplaces
healthcare_workers
infection_control
animal_contact
food_safety
water_safety
outbreak_specific
professional_guidance
```

---

## 7.2 `disease_advice_sections`

```sql
create table disease_advice_sections (
  id uuid primary key,
  advice_document_id uuid not null
    references disease_advice_documents(id),

  section_type varchar(50) not null,
  heading text,
  body_plain_text text not null,
  body_structured jsonb,

  urgency varchar(30),
  audience text[] not null default '{}',

  source_quote text,
  source_anchor text,

  extraction_method varchar(30) not null,
  extraction_confidence numeric(5,4),

  sort_order integer not null,
  created_at timestamptz not null
);
```

Section types:

```text
about
transmission
symptoms
common_symptoms
serious_symptoms
emergency_action
self_care
prevention
vaccination
testing
treatment
isolation
exclusion
contact_health_service
contact_emergency_service
travel_advice
professional_advice
source_disclaimer
```

---

# 8. Advice Rules

## 8.1 No invented medical advice

G.O.D.S. must not generate original clinical instructions.

An LLM may:

* Classify official advice.
* Extract sections.
* Simplify wording for a broadcast summary.
* Translate text.
* Identify conflicting guidance.

An LLM must not independently decide:

* How long someone should isolate.
* Whether someone needs a vaccine.
* Whether someone should take medication.
* Whether a symptom requires emergency care.
* Whether travel is safe.
* Whether a person is infectious.

Any displayed instruction must retain a source reference and date.

## 8.2 Advice expiry

Advice can become stale quickly.

Each advice record needs:

```text
source_updated_at
last_checked_at
review_due_at
valid_until
staleness_status
```

Staleness:

```text
current
review_due
stale
withdrawn
superseded
unknown
```

Recommended checks:

```text
Outbreak-specific advice: every 30 minutes
General disease advice: daily
National guidance: every 6 hours during an active event
Travel advice: every 2 hours
Static fact sheets: weekly
```

## 8.3 Conflicting advice

When authorities disagree, do not merge the instructions into invented middle-ground advice.

Display:

```text
Advice for England — UKHSA/NHS
Advice for France — Santé publique France
Global background — WHO
```

If the user’s location is unknown:

```text
Global guidance from WHO is shown.
Select your country for local official guidance.
```

---

# 9. Advice Selection Service

Internal service:

```ts
interface AdviceSelectionRequest {
  diseaseId: string;
  eventId?: string;

  viewerCountry?: string;
  viewerSubdivision?: string;

  eventCountries?: string[];

  perspective:
    | "viewer"
    | "affected_population"
    | "traveller"
    | "general_public";

  audience?: string[];
  language?: string;
}
```

Selection algorithm:

```text
1. Find active outbreak-specific advice.
2. Match requested perspective.
3. Match viewer or affected jurisdiction.
4. Match language.
5. Rank authority.
6. Reject stale or withdrawn guidance.
7. Fill missing sections from higher-level authorities.
8. Always retain each section’s source.
```

Example output:

```json
{
  "disease": {
    "id": "DIS-000042",
    "name": "Measles"
  },
  "context": {
    "viewerCountry": "GB",
    "eventCountries": ["GB"],
    "perspective": "viewer"
  },
  "sections": [
    {
      "type": "when_to_seek_help",
      "heading": "Getting medical help",
      "summary": "Contact NHS services using the current official instructions.",
      "authority": "NHS",
      "jurisdiction": "England",
      "sourceUrl": "https://...",
      "sourceUpdatedAt": "2026-07-10T09:00:00Z"
    },
    {
      "type": "prevention",
      "heading": "Preventing measles",
      "summary": "...",
      "authority": "UKHSA",
      "jurisdiction": "England",
      "sourceUrl": "https://..."
    },
    {
      "type": "about",
      "heading": "About measles",
      "summary": "...",
      "authority": "WHO",
      "jurisdiction": "Global",
      "sourceUrl": "https://..."
    }
  ]
}
```

---

# 10. Public API Routes

Base:

```http
/api/v1/health
```

## Disease catalogue

```http
GET /api/v1/health/diseases
GET /api/v1/health/diseases/:diseaseId
GET /api/v1/health/diseases/:diseaseId/pathogens
GET /api/v1/health/diseases/:diseaseId/events
GET /api/v1/health/diseases/:diseaseId/sources
```

Disease list filters:

```text
search
letter
diseaseType
pathogenType
transmissionMode
vectorBorne
zoonotic
foodborne
waterborne
vaccineAvailable
country
language
activeOnly
cursor
limit
```

## Disease advice

```http
GET /api/v1/health/diseases/:diseaseId/advice
```

Query:

```text
viewerCountry=GB
viewerSubdivision=ENG
eventId=HE-2026-000184
perspective=viewer
audience=general_public
language=en-GB
```

## Explicitly request affected-location advice

```http
GET /api/v1/health/events/:eventId/advice
```

Query:

```text
perspective=affected_population
country=BR
language=pt-BR
```

## Traveller view

```http
GET /api/v1/health/events/:eventId/travel-advice
```

Query:

```text
travellerCountry=GB
destinationCountry=BR
language=en-GB
```

This route must aggregate official links and summaries but must not independently declare a destination safe or unsafe.

## Advice sources

```http
GET /api/v1/health/advice/sources
GET /api/v1/health/advice/sources/:sourceCode
GET /api/v1/health/advice/jurisdictions
```

## Search all diseases

```http
GET /api/v1/health/search?q=measles
```

Response may include:

```text
Diseases
Pathogens
Active events
Official advice
Aliases
```

---

# 11. Internal Advice Routes

```http
POST /api/internal/v1/health/advice/sources/:sourceCode/run
POST /api/internal/v1/health/advice/documents/:documentId/reprocess
POST /api/internal/v1/health/diseases/:diseaseId/rebuild-advice
GET  /api/internal/v1/health/advice/stale
GET  /api/internal/v1/health/advice/conflicts
```

Manual administration:

```http
POST  /api/admin/v1/health/diseases
PATCH /api/admin/v1/health/diseases/:diseaseId

POST  /api/admin/v1/health/diseases/:diseaseId/aliases
POST  /api/admin/v1/health/diseases/:diseaseId/pathogens

POST  /api/admin/v1/health/advice/:adviceId/approve
POST  /api/admin/v1/health/advice/:adviceId/withdraw
POST  /api/admin/v1/health/advice/:adviceId/replace
```

---

# 12. NHS Content API Adapter

Adapter:

```text
nhs-website-content
```

Initial resources:

```text
Conditions A–Z
Symptoms A–Z
Tests and treatments
Medicines
Vaccinations
Pregnancy
Mental health, where relevant
```

NHS officially exposes these content areas through its Website Content API.

The adapter must store:

```text
Page identifier
Page URL
Title
Description
Structured sections
Last reviewed date
Next review date, where supplied
Content type
Referenced services
Original JSON
```

Do not treat all NHS content as applying across the entire UK. Tag it according to its actual jurisdiction.

---

# 13. UKHSA Adapter

UKHSA should primarily supply:

```text
Outbreak-specific public-health guidance
Notifiable-disease status
Exclusion guidance
School and childcare guidance
Infection-prevention guidance
Professional health-protection guidance
Surveillance context
```

UKHSA publishes disease-reporting requirements and setting-specific infection guidance, including guidance for education and childcare environments.

Professional guidance must be marked:

```json
{
  "audience": ["healthcare_worker", "public_health_professional"],
  "publicSummaryAllowed": true,
  "notForSelfDiagnosis": true
}
```

---

# 14. WHO Adapter

WHO disease pages should populate:

```text
Canonical global name
Synonyms
Disease overview
Cause/pathogen
Transmission
Symptoms
Global prevention
Vaccination status
Global treatment overview
At-risk populations
Global burden
Fact-sheet references
```

WHO content is the fallback for countries where a suitable national source has not yet been integrated.

It is not automatically superior to a national health authority for local instructions.

---

# 15. ECDC Adapter

ECDC should supply:

```text
European disease factsheets
Regional epidemiology
European risk assessments
Public-health control context
European threat reports
Professional guidance
```

ECDC tracks more than 50 infectious-disease topics and publishes disease information, surveillance and threat assessments focused on Europe.

ECDC content should normally rank:

```text
Above WHO for European regional context
Below national authorities for local public instructions
```

---

# 16. Country Authority Registry

Create:

```sql
create table health_authorities (
  id uuid primary key,

  code varchar(100) unique not null,
  name text not null,
  short_name varchar(100),

  authority_type varchar(40) not null,
  jurisdiction_type varchar(30) not null,

  country_code char(2),
  subdivision_code varchar(100),
  who_region varchar(20),

  languages text[] not null default '{}',

  official_domain text,
  advice_priority integer not null,
  professional_only boolean not null default false,

  enabled boolean not null default true,

  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

Seed examples:

```text
WHO
WHO AFRO
WHO EMRO
WHO EURO
WHO PAHO
WHO SEARO
WHO WPRO
ECDC
UKHSA
NHS
Public Health Scotland
NHS inform
Public Health Wales
NHS 111 Wales
Public Health Agency Northern Ireland
Africa CDC
```

Later, add national agencies country by country.

---

# 17. UI Design

## Disease panel

```text
MEASLES

Highly contagious viral infection

Current events: 14
Affected countries: 9

[Overview]
[Symptoms]
[Prevention]
[Official advice]
[Current outbreaks]
[Sources]
```

## Advice selector

```text
Advice for:
[ United Kingdom ▾ ]

Viewing:
[ For residents ▾ ]

Official sources:
NHS · UKHSA · WHO
```

## Event advice panel

```text
OFFICIAL ADVICE

For people in England
Source: NHS / UKHSA
Updated: 10 July 2026

[Current sourced summary]

For travellers from the UK
Source: official UK travel-health guidance

Global disease information
Source: World Health Organization
```

Every advice card must show:

```text
Authority
Jurisdiction
Last checked
Source link
Whether it is general or outbreak-specific
```

---

# 18. Broadcast Rules

The live stream should not read lengthy clinical advice.

Permitted broadcast copy:

```text
“UK health authorities advise people with relevant symptoms
to follow current NHS guidance before attending a healthcare setting.”
```

Better:

```text
“Official advice differs by country. Scan or visit the event page
for guidance from your local health authority.”
```

Avoid broadcast statements such as:

```text
“You should isolate for seven days.”
“Take this medicine.”
“You do not need medical help.”
“This disease is harmless.”
“Travel is safe.”
```

Unless the exact statement is current, attributed, jurisdiction-correct official guidance—and even then, link viewers to the authority rather than presenting G.O.D.S. as the medical authority.

---

# 19. Translation

Store:

```text
Original official content
Official translated version, when supplied
Machine translation
Translation model/version
Translation confidence
Last translated timestamp
```

Ranking:

```text
1. Official content in requested language
2. Official authority-provided translation
3. Another authoritative source in requested language
4. Clearly labelled machine translation
```

Never silently present machine-translated clinical instructions as official wording.

---

# 20. Recommended Build Order

## Phase A

* Diseases
* Pathogens
* Disease aliases
* WHO global disease pages
* ECDC disease pages
* NHS Website Content API
* UKHSA guidance
* Advice authority registry
* UK jurisdiction handling
* Disease detail and advice routes

## Phase B

* Scotland, Wales and Northern Ireland sources
* Country-aware selection engine
* Advice version history
* Outbreak-specific overrides
* Advice conflict detection
* Staleness monitoring

## Phase C

* PAHO
* Africa CDC
* WHO regional offices
* EU national health authorities
* Australian, Canadian, New Zealand and Asian national authorities
* Multilingual official guidance

## Phase D

* Full global authority registry
* Traveller-perspective advice
* Local and subnational health authorities
* Automated authority discovery with manual approval

---

# 21. V1 Practical Target

Do not attempt all countries immediately.

Launch with:

```text
Global baseline:
    WHO

Europe:
    ECDC

United Kingdom:
    NHS
    UKHSA
    Public Health Scotland / NHS inform
    Public Health Wales / NHS 111 Wales
    Public Health Agency Northern Ireland

United States:
    CDC, jurisdiction-tagged only

Regional outbreak context:
    PAHO
    Africa CDC
```

That gives the platform global coverage without making American guidance the universal default.

---

# 22. Naming

Recommended UI names:

```text
Disease Library
Official Health Advice
Advice for Your Region
Global Health Events
```

Avoid:

```text
G.O.D.S. Medical Advice
Recommended Treatment
Diagnosis
Personal Risk
Safe / Unsafe
```

Recommended disclaimer:

```text
G.O.D.S. organises information published by recognised health
authorities. Advice can vary by location and may change during an
outbreak. Follow the linked guidance from the health authority
responsible for your area. This service does not provide diagnosis
or personalised medical advice.
```

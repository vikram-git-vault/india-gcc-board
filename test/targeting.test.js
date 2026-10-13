import { classifyRole } from '../lib/targeting.js';
import { detectLevel } from '../lib/parser.js';

// Real titles from the scraped data (2026-09-14 snapshot).
const cases = [
  // [title, tier, grade, family]
  ['Senior Vice President, Application Development Manager', 'target', 'SVP', 'Engineering leadership'],
  ['Director, POM Product Management Manager', 'target', 'Director', 'Product'],
  ['Vice President, POM Technical Product Management - Developer Marketplace', 'target', 'VP', 'Product'],
  ['Senior Vice President, Site Reliability Engineer Manager', 'target', 'SVP', 'Engineering leadership'],
  ['AI Product Manager - Vice President', 'target', 'VP', 'Product'],
  ['Senior Vice President, AI Innovation Lead', 'target', 'SVP', 'AI / Data leadership'],
  ['Director Data Architecture', 'target', 'Director', 'AI / Data leadership'],
  ['Associate Director Software Engineering', 'target', 'Associate Director', 'Engineering leadership'],
  ['Development Associate Director', 'target', 'Associate Director', 'Engineering leadership'],
  ['Vice President - Middleware Platform Modernization', 'target', 'VP', 'Engineering leadership'],
  ['Head of India Client and Product Reporting Platform, Vice President', 'target', 'VP', 'Delivery / Program / Transformation'],
  ['AVP_ Data Products-Wealth Management and AI Data Products', 'exception', 'AVP', 'Product'],

  // Shapes not in the snapshot, found by the Step 1 verifier.
  ['Director, Engineering', 'target', 'Director', 'Engineering leadership'],
  ['Director of Engineering', 'target', 'Director', 'Engineering leadership'],
  ['VP Engineering', 'target', 'VP', 'Engineering leadership'],
  ['Head of Engineering', 'target', 'Head', 'Engineering leadership'],
  ['Head of Technology', 'target', 'Head', 'Engineering leadership'],
  ['Head, Engineering', 'target', 'Head', 'Engineering leadership'],
  ['Payments Engineering Head', 'target', 'Head', 'Engineering leadership'],
  ['Senior Director - Cloud Engineering', 'target', 'Director', 'Engineering leadership'],
  ['Director, Site Reliability Engineering', 'target', 'Director', 'Engineering leadership'],
  ['VP - DevOps Lead', 'target', 'VP', 'Engineering leadership'],
  ['Director, IT', 'target', 'Director', 'Engineering leadership'],
  ['VP, Digital Banking Technology', 'target', 'VP', 'Engineering leadership'],
  ['Director, Core Banking Modernisation', 'target', 'Director', 'Engineering leadership'],
  ['Head of Data', 'target', 'Head', 'AI / Data leadership'],
  ['Director, MLOps', 'target', 'Director', 'AI / Data leadership'],
  ['Director, Risk Technology', 'target', 'Director', 'Engineering leadership'],
  ['VP - Risk Technology Delivery Lead', 'target', 'VP', 'Engineering leadership'],
  ['Director, Finance Technology Program Management', 'target', 'Director', 'Engineering leadership'],
  ['Head of Treasury Technology', 'target', 'Head', 'Engineering leadership'],
  ['VP, Software Engineering People Manager', 'target', 'VP', 'Engineering leadership'],
  ['Director, Growth Product Management', 'target', 'Director', 'Product'],
  ['VP, Agile Delivery Lead', 'target', 'VP', 'Delivery / Program / Transformation'],
  ['Vice President - Release Manager', 'target', 'VP', 'Delivery / Program / Transformation'],
  ['Executive Director, Product Owner', 'target', 'Director', 'Product'],
  ['Director, MD Office Technology Programs', 'target', 'Director', 'Engineering leadership'],
  ['AVP - Head of Program Management', 'exception', 'AVP', 'Delivery / Program / Transformation'],
  ['Senior Manager - Head of Delivery', 'exception', 'Senior Manager', 'Delivery / Program / Transformation'],
  ['Sr.Manager - Software Engineering', 'exception', 'Senior Manager', 'Engineering leadership'],
  ['AVP - Scrum Master', 'exception', 'AVP', 'Delivery / Program / Transformation'],
  ['Senior Technical Program Manager', 'target', 'Lead role (ungraded)', 'Delivery / Program / Transformation'],
  ['Vice President, Technical Product Analyst', 'excluded', 'VP', null],
  ['AVP, Data Product Engineer', 'excluded', 'AVP', null],
  ['Head-Office Operations Platform Lead', 'excluded', null, null],
  ['Executive Vice President, Technology', 'excluded', 'EVP / C-level', null],
  ['Chief Technology Officer', 'excluded', 'EVP / C-level', null],
  ['VP People Delivery and Execution', 'excluded', 'VP', null],
  ['IT Strategic Sourcing Associate Director', 'excluded', 'Associate Director', null],
  ['Integrated IT Audit, Vice President', 'excluded', 'VP', null],
  ['Vice President - SaT - GOV - SaT - TCF - Infrastructure Advisory - Ahmedabad', 'excluded', 'VP', null],
  ['Business Delivery VP', 'target', 'VP', 'Delivery / Program / Transformation'],
  ['Technical Manager, Vice President', 'target', 'VP', 'Engineering leadership'],

  ['AVP, Data Product Owner – Transactions, Positions & Books and Records (TBAR)', 'exception', 'AVP', 'Product'],
  ['AVP - Software Engineering Manager - Platform Modernizaton', 'exception', 'AVP', 'Engineering leadership'],
  ['Technology Implementation, AVP', 'exception', 'AVP', 'Engineering leadership'],
  ['Sr. Manager, Software Engineering (10 to 14 years, GenAI)', 'exception', 'Senior Manager', 'AI / Data leadership'],
  ['Senior Manager, Software Engineering', 'exception', 'Senior Manager', 'Engineering leadership'],
  ['Software Senior Engineering Manager', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  // Engineering people-leader titles with no grade (user decision 2026-10-13).
  ['Engineering Manager', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Software Development Manager', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Delivery Manager - Payments Platform', 'target', 'Lead role (ungraded)', 'Delivery / Program / Transformation'],
  ['Engineering Lead - Cloud Platforms', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Chapter Lead - Data Engineering', 'target', 'Lead role (ungraded)', 'AI / Data leadership'],
  ['Chapter Leader, Software Engineer', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Squad Lead - Digital Channels', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Squad Leader', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Tribe Lead, Wealth Platforms', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Technical Product Manager', 'target', 'Lead role (ungraded)', 'Product'],
  ['Senior Technical Product Owner', 'target', 'Lead role (ungraded)', 'Product'],
  ['Technology Lead', 'excluded', null, null],
  ['Lead Software Engineer', 'excluded', null, null],
  ['Associate Engineering Manager', 'excluded', null, null],
  ['Chapter Lead - Compliance Testing', 'excluded', 'Lead role (ungraded)', null],
  // Step 6 verifier findings.
  ['Programme Manager - Digital Banking', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Manager, Software Engineering', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Product Lead - Payments', 'target', 'Lead role (ungraded)', 'Product'],
  ['Product Management Lead', 'target', 'Lead role (ungraded)', 'Product'],
  ['Agile Delivery Lead', 'target', 'Lead role (ungraded)', 'Delivery / Program / Transformation'],
  ['Delivery Manager', 'target', 'Lead role (ungraded)', 'Delivery / Program / Transformation'],
  ['Engineering Manager - Application Support', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Squad Lead - Infrastructure Operations', 'target', 'Lead role (ungraded)', 'Engineering leadership'],
  ['Application Support Engineering Associate Director', 'target', 'Associate Director', 'Engineering leadership'],
  ['Senior Vice President, Production Services Infrastructure Support', 'target', 'SVP', 'Engineering leadership'],
  ['Vice President, Production Services Application Support', 'excluded', 'VP', null],
  ['Head of Product', 'target', 'Head', 'Product'],
  ['Head - Product', 'target', 'Head', 'Product'],
  ['Business Development Manager - SaaS Product', 'excluded', 'Lead role (ungraded)', null],
  ['Account Development Manager', 'excluded', 'Lead role (ungraded)', null],
  ['Lead Product Manager- Technical', 'target', 'Lead role (ungraded)', 'Product'],
  // Ungraded product and program titles (user decision 2026-10-13).
  ['Sr Product Owner, BI & Analytics', 'target', 'Lead role (ungraded)', 'Product'],
  ['Product Manager (Data Governance Platform, Metadata Management, Data Stewardship, Access Management) (6-12 years)', 'target', 'Lead role (ungraded)', 'Product'],
  ['Technical Product Owner - CLM', 'target', 'Lead role (ungraded)', 'Product'],
  ['Senior Product Manager, Platform and Gateway', 'target', 'Lead role (ungraded)', 'Product'],
  ['AI Education Specialist - Senior Technical Trainer / Program Manager', 'excluded', null, null],

  ['Vice President, Full-Stack Engineer', 'excluded', 'VP', null],
  ['Director, Full Stack Engineer', 'excluded', 'Director', null],
  ['Senior Full Stack Engineer, AVP', 'excluded', 'AVP', null],
  ['Vice President, Product Design', 'excluded', 'VP', null],
  ['Software Development Engineer in Test Associate Director', 'excluded', 'Associate Director', null],
  ['Senior Vice President, Treasury and ALM', 'excluded', 'SVP', null],
  ['Vice President, Head of Legal for India', 'excluded', 'VP', null],
  ['Director, Information Security Manager', 'excluded', 'Director', null],
  ['Vice President, Model Risk Management AI, Wealth and Investments', 'excluded', 'VP', null],
  ['Senior Risk Analytics Consultant, Senior Assistant Vice President', 'excluded', 'AVP', null],
  ['India Head of CX Platforms & Development, State Street Investment Management, Managing Director', 'excluded', 'Managing Director', null],
  ['Associate Vice President', 'excluded', 'AVP', null],
  ['Senior Product Owner - Service and Supervision (IVR)', 'target', 'Lead role (ungraded)', 'Product'],
  ['Senior Specialist, POM Product Owner', 'excluded', null, null],
  ['Platform Engineer II – Windows / Active Directory', 'excluded', null, null],
  ['Technical Program Manager', 'target', 'Lead role (ungraded)', 'Delivery / Program / Transformation'],
  ['Senior Product Analyst', 'excluded', null, null],
];

describe('classifyRole', () => {
  test.each(cases)('%s -> %s', (title, tier, grade, family) => {
    const result = classifyRole(title);
    expect(result.tier).toBe(tier);
    expect(result.grade).toBe(grade);
    expect(result.family).toBe(family);
    expect(typeof result.reason).toBe('string');
  });

  test('empty and missing titles are excluded, not thrown', () => {
    expect(classifyRole('').tier).toBe('excluded');
    expect(classifyRole(undefined).tier).toBe('excluded');
  });
});

describe('detectLevel (title only)', () => {
  test('a plain title is not tagged lead', () => {
    expect(detectLevel('Software Engineer')).toBe('entry');
  });
  test('grade words still map to lead', () => {
    expect(detectLevel('Vice President, POM Product Owner')).toBe('lead');
  });
});

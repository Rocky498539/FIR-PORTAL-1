// End-to-end tests for the FIR / NCR registration flow in FIR.html.
// Run from this folder:  npm install && npx playwright test
const { test, expect } = require('@playwright/test');

const SNATCHING = 'Kavita Singh, 41, reported that two men on a motorcycle snatched her gold chain near Kalyanpur Crossing on 4 September 2026 at 7:45 am.';
const VERBAL_ABUSE = 'Ramesh Kumar, 45, reported that his neighbour verbally abused him in front of his shop on MG Road on 4 September 2026 at 8:15 pm.';

/* Fresh, logged-in app with no cases. The AI endpoint is blocked so only the local engine answers. */
async function openApp(page, { cases, lang } = {}){
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  await page.route('**/api.anthropic.com/**', r=>r.abort());
  await page.addInitScript(()=>{
    window.__printed = [];
    window.print = ()=>{ window.__printed.push(document.body.className); };
  });
  await page.goto('/FIR.html');
  await page.evaluate(({ cases, lang })=>{
    localStorage.clear();
    localStorage.setItem('axial_login', JSON.stringify({ mobile:'9876543210' }));
    localStorage.setItem('axial_samples_loaded_v1', '1');
    localStorage.setItem('axial_lang', lang || 'en');
    if(cases) localStorage.setItem('axial_ims_db_v1', JSON.stringify(cases));
  }, { cases, lang });
  await page.reload();
  return errors;
}

async function startNewCase(page){
  await page.locator('.side-cta').click();
  await expect(page.locator('.classify-q')).toBeVisible();
}

/* Fills every field the FIR needs, after letting the narration fill what it can. */
async function fillComplaint(page, narration){
  await page.locator('#complaint-freetext-new').fill(narration);
  await page.locator('#complaint-freetext-new-extract-btn').click();
  await expect(page.locator('#complaint-freetext-new-status')).toContainText('Details filled');
  const f = (name)=> page.locator(`#complaint-form [name="${name}"]`);
  await f('policeStation').fill('Kalyanpur');
  await f('district').fill('Kanpur Nagar');
  await f('complainantName').fill(narration.split(',')[0]);
  await f('guardianName').fill('Shiv Prasad');
  await f('age').fill('41');
  await f('gender').selectOption('Female');
  await f('idType').selectOption('Aadhaar (UID)');
  await f('idNumber').fill('XXXX XXXX 4521');
  await f('address').fill('C-22, Awas Vikas 1, Kalyanpur, Kanpur Nagar');
  await f('placeOfIncident').fill('Kalyanpur Crossing');
  await f('dateOfIncident').fill('2026-09-04');
}
async function saveComplaint(page){ await page.getByRole('button', { name:'Save complaint & continue' }).click(); }

async function registerComplaint(page, kind, narration){
  await startNewCase(page);
  await page.locator(`[data-choice="${kind}"]`).click();
  await expect(page.locator('.case-type-pill')).toContainText(kind==='NCR' ? 'NCR case' : 'FIR case');
  await fillComplaint(page, narration);
  await saveComplaint(page);
}
async function navTabs(page){ return (await page.locator('.reg-nav .reg-tab > span:not(.ms):not(.reg-dot)').allInnerTexts()).map(s=>s.trim()); }
async function caseState(page){ return page.evaluate(()=>getCase(UI.caseId)); }

/* NCR case up to the NCR tab, sections confirmed. */
async function ncrCaseAtNcrTab(page){
  await registerComplaint(page, 'NCR', VERBAL_ABUSE);
  await expect(page.locator('.page-title')).toHaveText('BNS sections');
  await expect(page.locator('.sec-row')).toHaveCount(1);
  await page.getByRole('button', { name:'Confirm sections & continue' }).click();
  await expect(page.locator('#ncr-task-title')).toBeVisible();
}

test('(a) FIR: complaint runs through the full FIR flow', async ({ page })=>{
  const errors = await openApp(page);
  await registerComplaint(page, 'FIR', SNATCHING);
  // No warning: the narration is cognizable and FIR was chosen
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.page-title')).toHaveText('Category & Sub-category');
  expect(await navTabs(page)).toEqual(['Overview','Case diary','Classification','Complaint','Category','BNS Sections','FIR','IO Assignment','GD','Writer Statement']);
  // Pre-filled from the narration, officer confirms
  await expect(page.locator('#cc-category')).toHaveValue('Property Crime');
  await expect(page.locator('#cc-subcategory')).toHaveValue('Snatching');
  await page.getByRole('button', { name:'Confirm & continue' }).click();

  // BNS sections driven by the sub-category
  await expect(page.locator('.sec-row').first()).toBeVisible();
  await expect(page.locator('.sec-code')).toContainText(['BNS 304']);
  await expect(page.locator('#section-mismatch')).toHaveCount(0);
  await page.getByRole('button', { name:'Confirm sections & continue' }).click();

  // FIR, with the optional BNSS 173(3) note (snatching: up to 3 years)
  await expect(page.locator('#fir-prelim-note')).toContainText('Preliminary enquiry possible within 14 days with DSP-rank permission (BNSS 173(3)).');
  await page.getByRole('button', { name:'Prepare FIR for CCTNS' }).click();
  await page.getByRole('button', { name:'Copy FIR for CCTNS' }).click();
  await page.locator('#fir-number-input').fill('0301/2026');
  await page.locator('#fir-continue').click();

  // Investigating officer
  await page.locator('input[name="name"]').fill('Suresh Yadav');
  await page.locator('input[name="rank"]').fill('Sub-Inspector');
  await page.getByRole('button', { name:'Assign IO & continue' }).click();

  // GD
  await page.getByRole('button', { name:'Prepare GD entry' }).click();
  await expect(page.locator('#gd-sheet-body')).toContainText('FIR Number: 0301/2026');
  await page.getByRole('button', { name:'Copy GD for CCTNS' }).click();
  await page.locator('#gd-number-input').fill('0190');
  await page.locator('#gd-continue').click();

  // FIR Writing Officer Statement
  await page.locator('#stmt-recordedBy').fill('Manoj Kumar');
  await page.locator('#stmt-recordedByRank').fill('Sub-Inspector');
  await page.locator('#stmt-statementDate').fill('2026-09-04');
  await page.locator('#stmt-statementTime').fill('11:30');
  await page.getByRole('button', { name:'Review & confirm statement' }).click();
  await page.locator('.modal [data-act="ok"]').click();
  await expect(page.locator('.complete-kicker')).toHaveText('Case registration complete');

  const c = await caseState(page);
  expect(c.classification).toBe('FIR');
  expect(c.classifiedAt).not.toBe('');
  expect(c.classifiedBy).toContain('9876543210');
  expect(c.categoryConfirmed).toBe(true);
  expect(errors).toEqual([]);
});

test('(b) NCR: complaint runs through the NCR flow', async ({ page })=>{
  const errors = await openApp(page);
  await registerComplaint(page, 'NCR', VERBAL_ABUSE);
  await expect(page.locator('.modal')).toHaveCount(0);
  // Only the NCR path's tabs: no Category, FIR, IO, Writer Statement or Case diary
  expect(await navTabs(page)).toEqual(['Overview','Classification','Complaint','BNS Sections','NCR','GD']);
  await expect(page.locator('.page-sub').first()).toHaveText('NCR case: non-cognizable sections only.');
  // Suggested from the narration, non-cognizable only
  await expect(page.locator('.sec-code')).toHaveText(['BNS 352']);
  await expect(page.locator('.sec-row .tag-cog')).toHaveText(['Non-cognizable']);
  await page.getByRole('button', { name:'Confirm sections & continue' }).click();

  // NCR form + live preview, auto-filled
  const preview = page.locator('#ncr-sheet-body');
  await expect(preview).toContainText('NON-COGNIZABLE REPORT (NCR)');
  await expect(preview).toContainText('Ramesh Kumar');
  await expect(preview).toContainText('Kalyanpur');
  await expect(preview).toContainText('352');
  await expect(preview).toContainText("Copy given to complainant free of cost. Complainant referred to the Magistrate. No investigation without the Magistrate's order (BNSS 174).");
  await expect(page.locator('#ncr-action')).toHaveValue('Referred to Magistrate');
  await page.locator('#ncr-accused').fill('Mahesh, neighbour, House 12, MG Road');
  await expect(preview).toContainText('Mahesh, neighbour');
  await page.locator('#ncr-officer').fill('Rakesh Sharma');
  await page.locator('#ncr-officer-rank').fill('Head Constable');
  await expect(preview).toContainText('Head Constable Rakesh Sharma');

  await page.locator('#ncr-copy-main').click();
  await page.locator('#ncr-number-input').fill('0012/2026');
  await expect(preview).toContainText('0012/2026');
  await page.locator('#ncr-continue').click();

  // GD with NCR wording
  await expect(page.locator('.page-sub')).toHaveText('The GD entry will be prepared from the complaint and NCR information already recorded.');
  await page.getByRole('button', { name:'Prepare GD entry' }).click();
  const gd = page.locator('#gd-sheet-body');
  await expect(gd).toContainText('NCR Number: 0012/2026');
  await expect(gd).toContainText('Report type: Non-cognizable report (NCR)');
  await expect(gd).not.toContainText('FIR Number');
  await page.getByRole('button', { name:'Copy GD for CCTNS' }).click();
  await page.locator('#gd-number-input').fill('0191');
  await expect(page.locator('#gd-next-hint')).toHaveText('NCR registration is complete.');
  await page.locator('#gd-continue').click();
  await expect(page.locator('.complete-kicker')).toHaveText('Case registration complete');
  await expect(page.locator('.case-title')).toContainText('NCR 0012/2026');

  // The register shows NCR with its number
  await page.locator('.side-link').click();
  const row = page.locator('#case-rows .case-row').first();
  await expect(row.locator('.type-badge')).toHaveText('NCR');
  await expect(row).toContainText('NCR 0012/2026');
  await expect(row).toContainText('Registration complete');

  const c = await caseState(page);
  expect(c.classification).toBe('NCR');
  expect(c.ncr.enteringOfficer).toBe('Rakesh Sharma');
  expect(errors).toEqual([]);
});

test('(c) Help me decide: cognizable, non-cognizable, mixed and unclear', async ({ page })=>{
  await openApp(page);
  await startNewCase(page);
  await page.getByRole('button', { name:'Not sure? Help me decide' }).click();
  const ask = async (words)=>{
    await page.locator('#classify-help-text').fill(words);
    await page.locator('#classify-suggest-btn').click();
    return page.locator('#classify-result');
  };

  let r = await ask('mobile snatched');
  await expect(r).toContainText('Cognizable — snatching is cognizable');
  await expect(page.locator('[data-choice="FIR"]')).toHaveClass(/is-suggested/);
  await expect(page.locator('[data-choice="NCR"]')).not.toHaveClass(/is-suggested/);

  r = await ask('verbal abuse');
  await expect(r).toContainText('Non-cognizable — verbal abuse is non-cognizable');
  await expect(page.locator('[data-choice="NCR"]')).toHaveClass(/is-suggested/);

  r = await ask('verbal abuse, then he snatched my mobile');
  await expect(r).toContainText('Cognizable — snatching is cognizable');
  await expect(r).toContainText('BNSS 174(4)');
  await expect(page.locator('[data-choice="FIR"]')).toHaveClass(/is-suggested/);

  r = await ask('dispute with neighbour about water supply');
  await expect(r).toContainText("Can't tell from these words. Choose the option that fits the offence.");
  await expect(page.locator('.classify-btn.is-suggested')).toHaveCount(0);

  // A suggestion never decides on its own: still on the question, no case created
  await expect(page.locator('.classify-q')).toBeVisible();
  expect(await page.evaluate(()=>DB.order.length)).toBe(0);
});

test('(d) NCR chosen, cognizable narration: warning, then switch to FIR', async ({ page })=>{
  await openApp(page);
  await registerComplaint(page, 'NCR', SNATCHING);
  const modal = page.locator('.modal');
  await expect(modal.locator('.modal-title')).toHaveText('This complaint looks cognizable — an FIR should be registered.');
  await expect(modal).toContainText('Cognizable — snatching is cognizable');
  await modal.getByRole('button', { name:'Switch to FIR' }).click();
  // Reason is required
  await expect(modal.locator('[data-act="ok"]')).toBeDisabled();
  await modal.locator('#dlg-input').fill('Chain was snatched, cognizable');
  await modal.getByRole('button', { name:'Switch to FIR' }).click();

  await expect(page.locator('.page-title')).toHaveText('Category & Sub-category');
  const c = await caseState(page);
  expect(c.classification).toBe('FIR');
  expect(c.classificationReason).toBe('Chain was snatched, cognizable');
  expect(c.classificationHistory.map(h=>h.to)).toEqual(['NCR','FIR']);
  expect(c.complaint.complainantName).toBe('Kavita Singh');
  expect(c.complaint.description).toContain('snatched her gold chain');
  expect(await navTabs(page)).toContain('IO Assignment');
});

test('(d) NCR chosen, cognizable narration: the officer can dismiss and continue', async ({ page })=>{
  await openApp(page);
  await registerComplaint(page, 'NCR', SNATCHING);
  await page.locator('.modal').getByRole('button', { name:'Keep NCR' }).click();
  await expect(page.locator('.page-title')).toHaveText('BNS sections');
  expect((await caseState(page)).classification).toBe('NCR');
});

test('(e) FIR chosen, non-cognizable narration: warning, then switch to NCR', async ({ page })=>{
  await openApp(page);
  await registerComplaint(page, 'FIR', VERBAL_ABUSE);
  const modal = page.locator('.modal');
  await expect(modal.locator('.modal-title')).toHaveText('This complaint looks non-cognizable.');
  await expect(modal).toContainText('Non-cognizable — verbal abuse is non-cognizable');
  await modal.getByRole('button', { name:'Switch to NCR' }).click();
  await modal.locator('#dlg-input').fill('Only verbal abuse, no injury');
  await modal.locator('#dlg-input').press('Enter');

  await expect(page.locator('.page-title')).toHaveText('BNS sections');
  expect(await navTabs(page)).toEqual(['Overview','Classification','Complaint','BNS Sections','NCR','GD']);
  const c = await caseState(page);
  expect(c.classification).toBe('NCR');
  expect(c.classificationReason).toBe('Only verbal abuse, no injury');
  expect(c.complaint.complainantName).toBe('Ramesh Kumar');
});

test('(f) section mismatch warnings on both paths', async ({ page })=>{
  await openApp(page);
  // NCR path: a cognizable section added by hand
  await registerComplaint(page, 'NCR', VERBAL_ABUSE);
  await expect(page.locator('#section-mismatch')).toHaveCount(0);
  await page.getByRole('button', { name:'Add another section' }).click();
  // Search lists non-cognizable sections only
  await page.locator('#bns-search').fill('snatch');
  await expect(page.locator('#bns-results')).toContainText('No matching sections.');
  await page.getByRole('button', { name:'Add it manually' }).click();
  await page.locator('#bns-custom-code').fill('304');
  await expect(page.locator('#bns-custom-msg')).toContainText('It is cognizable.');
  await page.locator('#bns-custom-add').click();
  const warn = page.locator('#section-mismatch');
  await expect(warn).toContainText('A cognizable section is selected: BNS 304.');
  await warn.getByRole('button', { name:'Switch to FIR' }).click();
  await page.locator('#dlg-input').fill('Section 304 applies');
  await page.locator('.modal [data-act="ok"]').click();
  let c = await caseState(page);
  expect(c.classification).toBe('FIR');
  expect(c.bns.sections.map(s=>s.code)).toEqual(['352','304']);
  await expect(page.locator('.page-title')).toHaveText('Category & Sub-category');

  // FIR path: every chosen section non-cognizable
  await page.locator('#cc-category').selectOption('Violent Crime');
  await page.locator('#cc-subcategory').selectOption('Assault');
  await page.getByRole('button', { name:'Confirm & continue' }).click();
  await expect(page.locator('#section-mismatch')).toHaveCount(0);
  for(const code of ['BNS 304']){
    await page.getByRole('button', { name:`Remove ${code}` }).click();
  }
  // Only 352 is left, which is non-cognizable; add 115 (also non-cognizable) by search. The add panel is still open.
  await expect(page.locator('#section-mismatch')).toContainText('Every chosen section is non-cognizable.');
  await page.locator('#bns-search').fill('Voluntarily causing hurt');
  await page.locator('#bns-results .check-item').first().getByRole('button', { name:'Add' }).click();
  await expect(page.locator('#section-mismatch')).toContainText('Every chosen section is non-cognizable.');
  await page.locator('#section-mismatch').getByRole('button', { name:'Switch to NCR' }).click();
  await page.locator('#dlg-input').fill('Only simple hurt and insult');
  await page.locator('.modal [data-act="ok"]').click();
  c = await caseState(page);
  expect(c.classification).toBe('NCR');
  expect(c.classificationHistory.map(h=>h.to)).toEqual(['NCR','FIR','NCR']);
  expect(c.bns.sections.map(s=>s.code)).toEqual(['352','115']);
});

test('(g) an old saved case loads and stays on the FIR flow', async ({ page })=>{
  // Shape saved by the previous version: no classification, category, NCR or history fields
  const old = {
    id:'case-old1', createdAt:'2026-05-02T10:00:00.000Z',
    complaint:{ complaintNumber:'CR/2026/001', complaintDate:'2026-05-02', complaintTime:'10:00', policeStation:'Kakadeo', district:'Kanpur Nagar',
      complainantName:'Pooja Verma', guardianName:'Rajendra Verma', age:'29', gender:'Female', mobile:'9000011002', address:'112/4, Kakadeo', idDetails:'',
      nationality:'Indian', occupation:'Teacher', idType:'Driving licence', idNumber:'UP78 2019 0045512',
      placeOfIncident:'Outside coaching mandi', dateOfIncident:'2026-05-01', timeOfIncident:'16:30', description:'Her scooter was stolen while parked.',
      crimeCategory:'Property Crime', crimeSubCategory:'Theft', registered:true },
    bns:{ sections:[{ code:'303', title:'Theft', desc:'' }], confirmed:true, autoIdentifyFor:'Property Crime|Theft' },
    fir:{ registered:true, number:'0251/2026', date:'2026-05-02', time:'10:30', narrative:'' },
    firCopyGenerated:true, firCctnsCopied:true,
    gd:{ generated:false, number:'', date:'', time:'' }, gdCctnsCopied:false, caseDiary:[],
    io:{ assigned:true, name:'Rekha Singh', rank:'Sub-Inspector', serviceNumber:'', station:'Kakadeo', date:'2026-05-02', time:'10:45' },
    sop:{ subcategoryLoaded:'', steps:[] }, evidence:[], esakshya:[],
    firStatement:{ fields:{}, generated:false }, status:'IO Assigned', finalised:false
  };
  const errors = await openApp(page, { cases:{ cases:{ [old.id]:old }, order:[old.id] } });
  await page.locator('.side-link').click();
  const row = page.locator('#case-rows .case-row').first();
  await expect(row.locator('.type-badge')).toHaveText('FIR');
  await expect(row).toContainText('FIR 0251/2026');
  await row.click();
  await expect(page.locator('.case-title')).toContainText('FIR 0251/2026');
  await expect(page.locator('.case-title .type-badge')).toHaveText('FIR');
  expect(await navTabs(page)).toEqual(['Overview','Case diary','Classification','Complaint','Category','BNS Sections','FIR','IO Assignment','GD','Writer Statement']);
  // Next step is unchanged: the GD
  await expect(page.locator('.next-card-text')).toHaveText('Prepare GD entry');
  // Category counts as done; the classification tab explains the default
  await expect(page.locator('.reg-tab.is-done', { hasText:'Category' })).toHaveCount(1);
  await page.locator('.reg-tab', { hasText:'Classification' }).click();
  await expect(page.locator('.classify-current-text')).toHaveText('Cognizable → FIR');
  await expect(page.locator('main')).toContainText('Before this step existed; treated as FIR');
  // Every tab of the FIR path opens
  for(const tab of ['Complaint','Category','BNS Sections','FIR','IO Assignment','GD','Writer Statement','Case diary','Overview']){
    await page.locator('.reg-tab', { hasText: tab }).first().click();
    await expect(page.locator('#main-content')).not.toBeEmpty();
  }
  const c = await caseState(page);
  expect(c.classification).toBe('FIR');
  expect(c.categoryConfirmed).toBe(true);
  expect(c.ncr.actionTaken).toBe('Referred to Magistrate');
  expect(errors).toEqual([]);
});

test('(h) Hindi and English on the Classification, NCR and GD tabs', async ({ page })=>{
  const errors = await openApp(page);
  await startNewCase(page);
  await page.getByRole('button', { name:'हिंदी' }).click();
  await expect(page.locator('.classify-q')).toHaveText('यह अपराध संज्ञेय है या असंज्ञेय?');
  await expect(page.locator('[data-choice="FIR"] .classify-btn-title')).toHaveText('संज्ञेय → एफआईआर');
  await expect(page.locator('[data-choice="NCR"] .classify-btn-title')).toHaveText('असंज्ञेय → एनसीआर');
  await page.locator('#classify-help-link').click();
  await page.locator('#classify-help-text').fill('mobile snatched');
  await page.locator('#classify-suggest-btn').click();
  await expect(page.locator('#classify-result')).toContainText('संज्ञेय — झपटमारी संज्ञेय है');
  // The language toggle stays on top and clickable
  for(const name of ['English','हिंदी']){
    const btn = page.getByRole('button', { name });
    const box = await btn.boundingBox();
    const topEl = await page.evaluate(({x,y})=>{ const el = document.elementFromPoint(x,y); return el && el.closest('.lang-switch') ? 'toggle' : (el && el.className); }, { x: box.x + box.width/2, y: box.y + box.height/2 });
    expect(topEl).toBe('toggle');
  }
  // Back to English to register quickly, then check the NCR and GD tabs in both languages
  await page.getByRole('button', { name:'English' }).click();
  await expect(page.locator('.classify-q')).toHaveText('Is this offence cognizable or non-cognizable?');
  await expect(page.locator('#classify-result')).toContainText('Cognizable — snatching is cognizable');
  await page.locator('[data-choice="NCR"]').click();
  await fillComplaint(page, VERBAL_ABUSE);
  await saveComplaint(page);
  await page.getByRole('button', { name:'Confirm sections & continue' }).click();

  await page.getByRole('button', { name:'हिंदी' }).click();
  await expect(page.locator('#ncr-task-title')).toHaveText('सीसीटीएनएस के लिए एनसीआर');
  await expect(page.locator('.doc-head-title')).toContainText('एनसीआर पूर्वावलोकन');
  const hiPreview = page.locator('#ncr-sheet-body');
  await expect(hiPreview).toContainText('असंज्ञेय अपराध रिपोर्ट (NCR)');
  await expect(hiPreview).toContainText('मजिस्ट्रेट के आदेश के बिना कोई विवेचना नहीं की जाएगी (BNSS 174)।');
  await expect(hiPreview).toContainText('की गई कार्रवाई: मजिस्ट्रेट को संदर्भित किया गया');
  await expect(page.locator('.reg-label .type-badge')).toHaveText('एनसीआर');
  // Language toggle not covered while the page is scrolled
  await page.mouse.wheel(0, 2000);
  const box = await page.getByRole('button', { name:'English' }).boundingBox();
  expect(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y).closest('.lang-switch'), { x: box.x + box.width/2, y: box.y + box.height/2 })).toBe(true);

  await page.locator('#ncr-copy-main').click();
  await page.locator('#ncr-number-input').fill('0044/2026');
  await page.locator('#ncr-continue').click();
  await expect(page.locator('.page-title')).toHaveText('जीडी प्रविष्टि');
  await page.getByRole('button', { name:'जीडी प्रविष्टि तैयार करें' }).click();
  const hiGd = page.locator('#gd-sheet-body');
  await expect(hiGd).toContainText('रिपोर्ट का प्रकार: असंज्ञेय अपराध रिपोर्ट (NCR)');
  await expect(hiGd).toContainText('NCR संख्या: 0044/2026');
  await expect(hiGd).not.toContainText('अपराध श्रेणी');

  await page.getByRole('button', { name:'English' }).click();
  await expect(page.locator('#gd-sheet-body')).toContainText('NCR Number: 0044/2026');
  await page.locator('.reg-tab', { hasText:'NCR' }).click();
  await expect(page.locator('#ncr-task-title')).toHaveText('NCR for CCTNS');
  await expect(page.locator('#ncr-sheet-body')).toContainText('NON-COGNIZABLE REPORT (NCR)');
  await page.locator('.reg-tab', { hasText:'Classification' }).click();
  await expect(page.locator('.classify-current-text')).toHaveText('Non-cognizable → NCR');
  await page.getByRole('button', { name:'हिंदी' }).click();
  await expect(page.locator('.classify-current-text')).toHaveText('असंज्ञेय → एनसीआर');
  await expect(page.getByRole('button', { name:'एफआईआर में बदलें' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('(i) NCR copy, download and print', async ({ page })=>{
  await openApp(page);
  await ncrCaseAtNcrTab(page);
  await page.locator('#ncr-number-input').fill('0012/2026');

  await page.locator('#ncr-copy').click();
  const copied = await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain('NON-COGNIZABLE REPORT (NCR)');
  expect(copied).toContain('NCR No.: 0012/2026');
  expect(copied).toContain('Bharatiya Nyaya Sanhita, 2023: 352');
  expect(copied.trim().endsWith("Copy given to complainant free of cost. Complainant referred to the Magistrate. No investigation without the Magistrate's order (BNSS 174).")).toBe(true);
  expect((await caseState(page)).ncrCctnsCopied).toBe(true);

  const [download] = await Promise.all([ page.waitForEvent('download'), page.locator('#ncr-download').click() ]);
  expect(download.suggestedFilename()).toBe('NCR_0012_2026.txt');
  const fs = require('fs');
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toBe(copied);

  await page.locator('#ncr-print').click();
  const printed = await page.evaluate(()=>window.__printed);
  expect(printed.length).toBe(1);
  expect(printed[0]).toContain('printing-doc');
  // In print, only the NCR sheet shows
  await page.emulateMedia({ media:'print' });
  await page.evaluate(()=>document.body.classList.add('printing-doc'));
  await expect(page.locator('.split-main')).toBeHidden();
  await expect(page.locator('#ncr-sheet-body')).toBeVisible();
  await expect(page.locator('.topbar')).toBeHidden();
});

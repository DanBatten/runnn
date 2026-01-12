#!/usr/bin/env tsx
/**
 * Import April 2025 bloodwork from Quest Diagnostics
 *
 * Data from two lab draws:
 * - April 7, 2025: Hormones, omega-3s, inflammation
 * - April 11, 2025: Lipids, metabolic, genetic markers
 */

import { initializeDb, closeDb } from '../src/db/client.js';
import { importLabPanel, importInsight, LabPanelInput } from './import-bloodwork.js';

// April 7, 2025 Lab Panel
const april7Panel: LabPanelInput = {
  collection_date: '2025-04-07',
  lab_name: 'Quest Diagnostics',
  fasting: true,
  notes: 'Comprehensive panel including hormones, omega-3s, autoimmune markers',
  results: [
    // Hormones
    { marker_name: 'Testosterone, Total', marker_code: '15983', category: 'hormones', value: 668, unit: 'ng/dL', ref_range_low: 250, ref_range_high: 1100, flag: 'NORMAL' },
    { marker_name: 'Testosterone, Free', marker_code: '14966', category: 'hormones', value: 56.1, unit: 'pg/mL', ref_range_low: 35, ref_range_high: 155, flag: 'NORMAL' },
    { marker_name: 'SHBG', marker_code: '30740', category: 'hormones', value: 59, unit: 'nmol/L', ref_range_low: 10, ref_range_high: 50, flag: 'HIGH', athletic_notes: 'Elevated SHBG reduces free testosterone availability' },
    { marker_name: 'DHEA-Sulfate', marker_code: '402', category: 'hormones', value: 310, unit: 'mcg/dL', ref_range_low: 25, ref_range_high: 508, flag: 'NORMAL' },
    { marker_name: 'FSH', marker_code: '466', category: 'hormones', value: 3.8, unit: 'mIU/mL', ref_range_low: 1.6, ref_range_high: 8.0, flag: 'NORMAL' },
    { marker_name: 'LH', marker_code: '7164', category: 'hormones', value: 6.1, unit: 'mIU/mL', ref_range_low: 1.5, ref_range_high: 9.3, flag: 'NORMAL' },
    { marker_name: 'Prolactin', marker_code: '746', category: 'hormones', value: 8.3, unit: 'ng/mL', ref_range_low: 2.0, ref_range_high: 18.0, flag: 'NORMAL' },
    { marker_name: 'Estradiol', marker_code: '4021', category: 'hormones', value: 24, unit: 'pg/mL', ref_range_low: 10, ref_range_high: 40, flag: 'NORMAL' },
    { marker_name: 'Cortisol, AM', marker_code: '367', category: 'hormones', value: 15.2, unit: 'mcg/dL', ref_range_low: 4.0, ref_range_high: 22.0, flag: 'NORMAL' },
    { marker_name: 'IGF-1', marker_code: '5765', category: 'hormones', value: 156, unit: 'ng/mL', ref_range_low: 53, ref_range_high: 331, flag: 'NORMAL' },

    // Thyroid
    { marker_name: 'TSH', marker_code: '899', category: 'thyroid', value: 1.47, unit: 'mIU/L', ref_range_low: 0.40, ref_range_high: 4.50, flag: 'NORMAL' },
    { marker_name: 'Free T4', marker_code: '866', category: 'thyroid', value: 1.1, unit: 'ng/dL', ref_range_low: 0.8, ref_range_high: 1.8, flag: 'NORMAL' },
    { marker_name: 'Free T3', marker_code: '16379', category: 'thyroid', value: 3.0, unit: 'pg/mL', ref_range_low: 2.3, ref_range_high: 4.2, flag: 'NORMAL' },
    { marker_name: 'Thyroid Peroxidase Antibodies', marker_code: '34429', category: 'thyroid', value: 1, unit: 'IU/mL', ref_range_text: '<9', flag: 'NORMAL' },

    // Fatty Acids
    { marker_name: 'Omega-3 Index', marker_code: '91715', category: 'fatty_acids', value: 5.0, unit: '%', ref_range_text: '>5.4 optimal', flag: 'LOW', athletic_notes: 'Slightly below optimal. Omega-3s support recovery and reduce inflammation.' },
    { marker_name: 'EPA', marker_code: '91716', category: 'fatty_acids', value: 1.0, unit: '%', ref_range_low: 0.4, ref_range_high: 3.0, flag: 'NORMAL' },
    { marker_name: 'DHA', marker_code: '91717', category: 'fatty_acids', value: 4.0, unit: '%', ref_range_low: 1.5, ref_range_high: 6.0, flag: 'NORMAL' },
    { marker_name: 'AA:EPA Ratio', marker_code: '91720', category: 'fatty_acids', value: 9.2, unit: 'ratio', ref_range_text: '<7.2 optimal', flag: 'HIGH', athletic_notes: 'Higher ratio suggests more pro-inflammatory state' },

    // Inflammation
    { marker_name: 'Homocysteine', marker_code: '31789', category: 'inflammation', value: 10.9, unit: 'umol/L', ref_range_text: '<15', flag: 'NORMAL', athletic_notes: 'Within range but optimal is <10 for cardiovascular health' },

    // Metabolic
    { marker_name: 'Leptin', marker_code: '35327', category: 'metabolic', value: 0.4, unit: 'ng/mL', ref_range_low: 0.5, ref_range_high: 12.5, flag: 'LOW', athletic_notes: 'Very low leptin consistent with lean athletic body composition' },
    { marker_name: 'MMA (Methylmalonic Acid)', marker_code: '706994', category: 'vitamins', value: 107, unit: 'nmol/L', ref_range_text: '<318', flag: 'NORMAL', athletic_notes: 'Normal MMA indicates adequate B12 status' },

    // Autoimmune
    { marker_name: 'ANA Screen', marker_code: '249', category: 'autoimmune', value: 1, unit: '', value_text: 'Positive', flag: 'ABNORMAL', athletic_notes: 'Low-titer positive ANA often clinically insignificant in healthy individuals' },
    { marker_name: 'ANA Titer', marker_code: '3245', category: 'autoimmune', value: 80, unit: 'titer', value_text: '1:40-1:80, Speckled', flag: 'ABNORMAL', athletic_notes: 'Very low titers, often benign' },

    // Kidney
    { marker_name: 'Cystatin C', marker_code: '7073', category: 'kidney', value: 0.82, unit: 'mg/L', ref_range_low: 0.53, ref_range_high: 0.95, flag: 'NORMAL' },
    { marker_name: 'eGFR (Cystatin C)', marker_code: 'calc', category: 'kidney', value: 110, unit: 'mL/min/1.73m2', ref_range_text: '>60', flag: 'NORMAL' },
  ]
};

// April 11, 2025 Lab Panel
const april11Panel: LabPanelInput = {
  collection_date: '2025-04-11',
  lab_name: 'Quest Diagnostics',
  fasting: true,
  notes: 'Comprehensive lipid panel, metabolic markers, genetic testing',
  results: [
    // Standard Lipids
    { marker_name: 'Total Cholesterol', marker_code: '303', category: 'lipids', value: 198, unit: 'mg/dL', ref_range_text: '<200', flag: 'NORMAL' },
    { marker_name: 'LDL Cholesterol', marker_code: '304', category: 'lipids', value: 123, unit: 'mg/dL', ref_range_text: '<100 optimal', flag: 'HIGH', athletic_notes: 'Above optimal. More important to look at particle number.' },
    { marker_name: 'HDL Cholesterol', marker_code: '305', category: 'lipids', value: 61, unit: 'mg/dL', ref_range_text: '>40', flag: 'NORMAL', athletic_notes: 'Good HDL level' },
    { marker_name: 'Triglycerides', marker_code: '306', category: 'lipids', value: 48, unit: 'mg/dL', ref_range_text: '<150', flag: 'NORMAL', athletic_notes: 'Excellent - indicates good metabolic health' },
    { marker_name: 'Non-HDL Cholesterol', marker_code: 'calc', category: 'lipids', value: 137, unit: 'mg/dL', ref_range_text: '<130', flag: 'HIGH' },

    // Advanced Lipids (Cardio IQ / NMR)
    { marker_name: 'ApoB', marker_code: '91155', category: 'lipids', value: 97, unit: 'mg/dL', ref_range_text: '<90 optimal', flag: 'HIGH', athletic_notes: 'Better predictor than LDL-C. Target <80 given E4 carrier status.' },
    { marker_name: 'LDL Particle Number', marker_code: '91157', category: 'lipids', value: 1863, unit: 'nmol/L', ref_range_text: '<1000 optimal', flag: 'HIGH', athletic_notes: 'Elevated particle count increases atherogenic risk' },
    { marker_name: 'LDL Small', marker_code: '91159', category: 'lipids', value: 312, unit: 'nmol/L', ref_range_text: '<193', flag: 'HIGH', athletic_notes: 'Small dense LDL is more atherogenic' },
    { marker_name: 'LDL Medium', marker_code: '91160', category: 'lipids', value: 480, unit: 'nmol/L', ref_range_text: '<395', flag: 'HIGH' },
    { marker_name: 'LDL Peak Size', marker_code: '91162', category: 'lipids', value: 218.7, unit: 'Angstrom', ref_range_text: '>222.9 Pattern A', flag: 'LOW', athletic_notes: 'Pattern B (smaller particles). More atherogenic pattern.' },
    { marker_name: 'HDL Large', marker_code: '91164', category: 'lipids', value: 4965, unit: 'nmol/L', ref_range_text: '>5363', flag: 'LOW' },
    { marker_name: 'VLDL Size', marker_code: '91165', category: 'lipids', value: 41.8, unit: 'nm', ref_range_text: '<42.4', flag: 'NORMAL' },
    { marker_name: 'LP-IR Score', marker_code: '91166', category: 'lipids', value: 15, unit: '', ref_range_text: '<45', flag: 'NORMAL', athletic_notes: 'Low insulin resistance score - excellent' },
    { marker_name: 'Lp(a)', marker_code: '10016', category: 'lipids', value: 11, unit: 'nmol/L', ref_range_text: '<75', flag: 'NORMAL', athletic_notes: 'Excellent - low genetic risk from Lp(a)' },

    // Inflammation
    { marker_name: 'hs-CRP', marker_code: '10124', category: 'inflammation', value: 0.19, unit: 'mg/L', ref_range_text: '<1.0 low risk', flag: 'NORMAL', athletic_notes: 'Excellent - very low systemic inflammation' },

    // Metabolic
    { marker_name: 'Glucose, Fasting', marker_code: '483', category: 'metabolic', value: 88, unit: 'mg/dL', ref_range_low: 65, ref_range_high: 99, flag: 'NORMAL' },
    { marker_name: 'Insulin, Fasting', marker_code: '561', category: 'metabolic', value: 5.2, unit: 'uIU/mL', ref_range_low: 2.0, ref_range_high: 19.6, flag: 'NORMAL', athletic_notes: 'Excellent - indicates good insulin sensitivity' },
    { marker_name: 'HbA1c', marker_code: '496', category: 'metabolic', value: 5.0, unit: '%', ref_range_text: '<5.7', flag: 'NORMAL', athletic_notes: 'Excellent long-term glucose control' },
    { marker_name: 'HOMA-IR', marker_code: 'calc', category: 'metabolic', value: 1.1, unit: '', ref_range_text: '<2.5', flag: 'NORMAL', athletic_notes: 'Excellent insulin sensitivity' },

    // Liver
    { marker_name: 'ALT', marker_code: '1', category: 'liver', value: 23, unit: 'U/L', ref_range_low: 6, ref_range_high: 29, flag: 'NORMAL' },
    { marker_name: 'AST', marker_code: '3', category: 'liver', value: 25, unit: 'U/L', ref_range_low: 10, ref_range_high: 40, flag: 'NORMAL' },
    { marker_name: 'GGT', marker_code: '820', category: 'liver', value: 18, unit: 'U/L', ref_range_low: 3, ref_range_high: 70, flag: 'NORMAL' },

    // Kidney
    { marker_name: 'BUN', marker_code: '5', category: 'kidney', value: 17, unit: 'mg/dL', ref_range_low: 7, ref_range_high: 25, flag: 'NORMAL' },
    { marker_name: 'Creatinine', marker_code: '6', category: 'kidney', value: 1.09, unit: 'mg/dL', ref_range_low: 0.70, ref_range_high: 1.33, flag: 'NORMAL' },
    { marker_name: 'eGFR', marker_code: 'calc', category: 'kidney', value: 89, unit: 'mL/min/1.73m2', ref_range_text: '>60', flag: 'NORMAL' },

    // Uric Acid
    { marker_name: 'Uric Acid', marker_code: '905', category: 'metabolic', value: 5.5, unit: 'mg/dL', ref_range_low: 3.5, ref_range_high: 8.5, flag: 'NORMAL' },

    // Electrolytes
    { marker_name: 'Sodium', marker_code: '836', category: 'electrolytes', value: 140, unit: 'mmol/L', ref_range_low: 136, ref_range_high: 145, flag: 'NORMAL' },
    { marker_name: 'Potassium', marker_code: '733', category: 'electrolytes', value: 4.3, unit: 'mmol/L', ref_range_low: 3.5, ref_range_high: 5.3, flag: 'NORMAL' },
    { marker_name: 'Chloride', marker_code: '330', category: 'electrolytes', value: 101, unit: 'mmol/L', ref_range_low: 98, ref_range_high: 110, flag: 'NORMAL' },
    { marker_name: 'CO2', marker_code: '330', category: 'electrolytes', value: 24, unit: 'mmol/L', ref_range_low: 20, ref_range_high: 32, flag: 'NORMAL' },
    { marker_name: 'Calcium', marker_code: '214', category: 'electrolytes', value: 9.5, unit: 'mg/dL', ref_range_low: 8.6, ref_range_high: 10.3, flag: 'NORMAL' },
    { marker_name: 'Magnesium', marker_code: '622', category: 'electrolytes', value: 2.1, unit: 'mg/dL', ref_range_low: 1.5, ref_range_high: 2.5, flag: 'NORMAL' },

    // Iron
    { marker_name: 'Iron', marker_code: '571', category: 'minerals', value: 99, unit: 'mcg/dL', ref_range_low: 50, ref_range_high: 180, flag: 'NORMAL' },
    { marker_name: 'Ferritin', marker_code: '457', category: 'minerals', value: 61, unit: 'ng/mL', ref_range_low: 20, ref_range_high: 345, flag: 'NORMAL', athletic_notes: 'Adequate but could be higher (optimal 50-150 for athletes)' },
    { marker_name: 'TIBC', marker_code: '7573', category: 'minerals', value: 348, unit: 'mcg/dL', ref_range_low: 250, ref_range_high: 425, flag: 'NORMAL' },
    { marker_name: 'Transferrin Saturation', marker_code: 'calc', category: 'minerals', value: 28, unit: '%', ref_range_low: 20, ref_range_high: 50, flag: 'NORMAL' },

    // Vitamins
    { marker_name: 'Vitamin D, 25-Hydroxy', marker_code: '17306', category: 'vitamins', value: 38, unit: 'ng/mL', ref_range_low: 30, ref_range_high: 100, flag: 'NORMAL', athletic_notes: 'Adequate but optimal for athletes is 40-60 ng/mL' },

    // Blood Count
    { marker_name: 'WBC', marker_code: '7068', category: 'blood', value: 5.0, unit: 'K/uL', ref_range_low: 3.8, ref_range_high: 10.8, flag: 'NORMAL' },
    { marker_name: 'RBC', marker_code: '7065', category: 'blood', value: 5.03, unit: 'M/uL', ref_range_low: 4.20, ref_range_high: 5.80, flag: 'NORMAL' },
    { marker_name: 'Hemoglobin', marker_code: '518', category: 'blood', value: 15.3, unit: 'g/dL', ref_range_low: 13.2, ref_range_high: 17.1, flag: 'NORMAL' },
    { marker_name: 'Hematocrit', marker_code: '507', category: 'blood', value: 45.2, unit: '%', ref_range_low: 38.5, ref_range_high: 50.0, flag: 'NORMAL' },
    { marker_name: 'MCV', marker_code: '615', category: 'blood', value: 90, unit: 'fL', ref_range_low: 80, ref_range_high: 100, flag: 'NORMAL' },
    { marker_name: 'MCH', marker_code: '612', category: 'blood', value: 30.4, unit: 'pg', ref_range_low: 27, ref_range_high: 33, flag: 'NORMAL' },
    { marker_name: 'MCHC', marker_code: '614', category: 'blood', value: 33.8, unit: 'g/dL', ref_range_low: 32, ref_range_high: 36, flag: 'NORMAL' },
    { marker_name: 'RDW', marker_code: '789', category: 'blood', value: 12.8, unit: '%', ref_range_low: 11, ref_range_high: 15, flag: 'NORMAL' },
    { marker_name: 'Platelets', marker_code: '729', category: 'blood', value: 198, unit: 'K/uL', ref_range_low: 140, ref_range_high: 400, flag: 'NORMAL' },

    // Genetic
    { marker_name: 'APOE Genotype', marker_code: '92746', category: 'genetic', value: 34, unit: '', value_text: 'E3/E4', flag: 'ABNORMAL', athletic_notes: 'E4 carrier - increased cardiovascular risk. Requires stricter lipid management.' },

    // Heavy Metals
    { marker_name: 'Lead, Blood', marker_code: '16378', category: 'toxins', value: 0.6, unit: 'mcg/dL', ref_range_text: '<3.5', flag: 'NORMAL' },
    { marker_name: 'Mercury, Blood', marker_code: '706945', category: 'toxins', value: 2.1, unit: 'mcg/L', ref_range_text: '<5.0', flag: 'NORMAL' },
  ]
};

async function main() {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';
  console.log(`Database: ${dbPath}`);
  initializeDb(dbPath);

  console.log('\nImporting April 2025 bloodwork...\n');

  // Import both panels
  const panel1Id = importLabPanel(april7Panel);
  const panel2Id = importLabPanel(april11Panel);

  // Generate insights
  console.log('\nGenerating insights...\n');

  // Cardiovascular risk insight (most important given APOE E4)
  importInsight(panel2Id, {
    insight_type: 'health_risk',
    category: 'cardiovascular',
    title: 'Elevated Cardiovascular Risk Markers',
    summary: 'APOE E4 carrier with elevated LDL particle count and ApoB. Despite excellent inflammatory markers (hs-CRP <0.2), lipid management should be proactive.',
    details: `Key findings:
- APOE 3/4 genotype: Carries one E4 allele associated with 2-3x increased CVD risk
- ApoB 97 mg/dL (optimal <80 for E4 carriers)
- LDL-P 1863 nmol/L (optimal <1000)
- Small dense LDL 312 nmol/L (elevated)
- LDL Pattern B (smaller particles)

Protective factors:
- hs-CRP <0.2 mg/L (excellent, low inflammation)
- Lp(a) 11 nmol/L (optimal, no genetic elevation)
- HDL 61 mg/dL (good)
- Triglycerides 48 mg/dL (excellent)
- LP-IR 15 (excellent insulin sensitivity)

Recommendations:
1. Consider lipid-lowering therapy discussion with physician
2. Maximize dietary saturated fat reduction
3. Increase omega-3 intake (EPA/DHA)
4. Continue endurance exercise (protective)
5. Monitor ApoB every 6-12 months`,
    related_markers: ['APOE Genotype', 'ApoB', 'LDL Particle Number', 'LDL Small', 'hs-CRP', 'Lp(a)'],
    confidence: 'high',
    action_recommended: 'Discuss lipid management strategy with physician given E4 carrier status. Target ApoB <80 mg/dL.',
    urgency: 'soon'
  });

  // Omega-3 optimization
  importInsight(panel1Id, {
    insight_type: 'optimization',
    category: 'recovery',
    title: 'Omega-3 Index Below Optimal',
    summary: 'Omega-3 index 5.0% is slightly below the 5.4% threshold associated with cardiovascular protection and optimal recovery.',
    details: `Current status:
- Omega-3 Index: 5.0% (target >5.4%, optimal 8-12%)
- EPA: 1.0%
- DHA: 4.0%
- AA:EPA ratio: 9.2 (target <7.2)

Impact on training:
- Suboptimal inflammation control post-exercise
- May slow recovery between hard sessions
- Higher omega-6:omega-3 ratio promotes pro-inflammatory state

Recommendations:
1. Increase fatty fish intake (salmon, mackerel, sardines) 3x/week
2. Consider 2-3g EPA+DHA supplement daily
3. Reduce omega-6 oils (vegetable, soybean, corn oil)
4. Retest in 3-4 months to assess response`,
    related_markers: ['Omega-3 Index', 'EPA', 'DHA', 'AA:EPA Ratio'],
    confidence: 'high',
    action_recommended: 'Supplement with 2-3g EPA+DHA daily and increase fatty fish consumption. Retest in 3-4 months.',
    urgency: 'routine'
  });

  // Metabolic health (positive)
  importInsight(panel2Id, {
    insight_type: 'monitoring',
    category: 'metabolic',
    title: 'Excellent Metabolic Health',
    summary: 'Insulin sensitivity and glucose control are excellent, indicating efficient metabolic function consistent with endurance training.',
    details: `Key markers:
- Fasting glucose: 88 mg/dL (excellent)
- HbA1c: 5.0% (excellent long-term control)
- Fasting insulin: 5.2 uIU/mL (optimal <8)
- HOMA-IR: 1.1 (excellent insulin sensitivity)
- LP-IR: 15 (low insulin resistance)
- Triglycerides: 48 mg/dL (excellent)

This profile indicates:
- Efficient fat oxidation during exercise
- Good glycogen storage and utilization
- Low metabolic disease risk
- Body is well-adapted to endurance training

Continue current training and dietary approach.`,
    related_markers: ['Glucose, Fasting', 'HbA1c', 'Insulin, Fasting', 'HOMA-IR', 'LP-IR Score', 'Triglycerides'],
    confidence: 'high',
    action_recommended: 'Maintain current approach. Annual monitoring sufficient.',
    urgency: 'informational'
  });

  // Hormonal health
  importInsight(panel1Id, {
    insight_type: 'monitoring',
    category: 'hormonal',
    title: 'Healthy Hormonal Profile with Elevated SHBG',
    summary: 'Testosterone and other hormones are well-balanced. SHBG is slightly elevated but free testosterone remains adequate.',
    details: `Hormonal status:
- Total testosterone: 668 ng/dL (good)
- Free testosterone: 56.1 pg/mL (adequate)
- SHBG: 59 nmol/L (elevated, ref <50)
- Cortisol AM: 15.2 mcg/dL (normal, no overtraining signs)
- DHEA-S: 310 mcg/dL (good)
- Thyroid: TSH 1.47, T3/T4 normal (excellent)

The elevated SHBG may be related to:
- Endurance training (common in runners)
- Low body fat percentage
- Diet composition

Impact on training:
- Recovery capacity appears adequate
- No signs of overtraining (cortisol normal)
- Thyroid function supports good metabolic rate

Monitor but no action needed currently.`,
    related_markers: ['Testosterone, Total', 'Testosterone, Free', 'SHBG', 'Cortisol, AM', 'DHEA-Sulfate', 'TSH'],
    confidence: 'high',
    action_recommended: 'Continue monitoring annually. No intervention needed.',
    urgency: 'informational'
  });

  // Iron status
  importInsight(panel2Id, {
    insight_type: 'monitoring',
    category: 'performance',
    title: 'Adequate Iron Status',
    summary: 'Iron stores and oxygen-carrying capacity are adequate for athletic performance.',
    details: `Iron panel:
- Ferritin: 61 ng/mL (adequate, optimal 50-150)
- Serum iron: 99 mcg/dL (good)
- Transferrin saturation: 28% (optimal)
- Hemoglobin: 15.3 g/dL (good)
- Hematocrit: 45.2% (good)

Status: Iron stores are adequate but not optimal. Could potentially benefit from slight increase.

For runners:
- Foot-strike hemolysis and sweat losses can deplete iron
- Current level adequate but worth monitoring
- Consider iron-rich foods but supplementation not required

Retest in 6-12 months or if fatigue develops.`,
    related_markers: ['Ferritin', 'Iron', 'Transferrin Saturation', 'Hemoglobin', 'Hematocrit'],
    confidence: 'high',
    action_recommended: 'Maintain iron-rich diet. Retest with next comprehensive panel or if unexplained fatigue develops.',
    urgency: 'informational'
  });

  // ANA finding
  importInsight(panel1Id, {
    insight_type: 'monitoring',
    category: 'autoimmune',
    title: 'Low-Titer Positive ANA (Likely Benign)',
    summary: 'ANA positive at low titers (1:40-1:80) with speckled pattern. This is common and usually clinically insignificant in healthy individuals.',
    details: `Finding:
- ANA Screen: Positive
- ANA Titer: 1:40-1:80
- Pattern: Speckled

Context:
- Low-titer positive ANA found in 5-15% of healthy individuals
- No symptoms of autoimmune disease present
- Speckled pattern is non-specific

This does NOT mean you have an autoimmune disease. However:
- Should be documented and tracked
- Inform physician of any new joint pain, rashes, or unusual fatigue
- May retest periodically to ensure stable

No impact on training.`,
    related_markers: ['ANA Screen', 'ANA Titer'],
    confidence: 'moderate',
    action_recommended: 'Document and monitor. Inform physician if autoimmune symptoms develop (joint pain, rashes, unusual fatigue). Consider rechecking in 1-2 years.',
    urgency: 'informational'
  });

  // Summary counts
  const db = (await import('../src/db/client.js')).getDb();

  const panelCount = db.prepare('SELECT COUNT(*) as count FROM lab_panels').get() as { count: number };
  const resultCount = db.prepare('SELECT COUNT(*) as count FROM biomarker_results').get() as { count: number };
  const insightCount = db.prepare('SELECT COUNT(*) as count FROM biomarker_insights').get() as { count: number };

  console.log('\n' + '═'.repeat(50));
  console.log('  Import Summary');
  console.log('═'.repeat(50));
  console.log(`  Lab Panels:       ${panelCount.count}`);
  console.log(`  Biomarker Results: ${resultCount.count}`);
  console.log(`  Insights:         ${insightCount.count}`);
  console.log('═'.repeat(50));

  closeDb();
  console.log('\nDone!');
}

main().catch(console.error);

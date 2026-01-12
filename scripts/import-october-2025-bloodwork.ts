#!/usr/bin/env tsx
/**
 * Import October 2025 bloodwork from Quest Diagnostics
 *
 * Collection Date: October 31, 2025
 * This is follow-up to April 2025 labs - allows trend analysis
 */

import { initializeDb, closeDb } from '../src/db/client.js';
import { importLabPanel, importInsight, LabPanelInput } from './import-bloodwork.js';

// October 31, 2025 Lab Panel
const october31Panel: LabPanelInput = {
  collection_date: '2025-10-31',
  lab_name: 'Quest Diagnostics',
  fasting: true,
  notes: 'Comprehensive panel including advanced lipids, CardioIQ, metabolic, allergy testing. Follow-up to April 2025.',
  results: [
    // Standard Lipids
    { marker_name: 'Total Cholesterol', category: 'lipids', value: 201, unit: 'mg/dL', ref_range_high: 200, flag: 'HIGH' },
    { marker_name: 'HDL Cholesterol', category: 'lipids', value: 63, unit: 'mg/dL', ref_range_low: 40, flag: 'NORMAL', athletic_notes: 'Improved from 61 in April' },
    { marker_name: 'Triglycerides', category: 'lipids', value: 55, unit: 'mg/dL', ref_range_high: 150, flag: 'NORMAL', athletic_notes: 'Excellent metabolic health indicator' },
    { marker_name: 'LDL Cholesterol', category: 'lipids', value: 123, unit: 'mg/dL', ref_range_high: 100, flag: 'HIGH', athletic_notes: 'Same as April. More important to track particle number.' },
    { marker_name: 'Chol/HDL Ratio', category: 'lipids', value: 3.2, unit: 'ratio', ref_range_high: 5.0, flag: 'NORMAL' },
    { marker_name: 'Non-HDL Cholesterol', category: 'lipids', value: 138, unit: 'mg/dL', ref_range_high: 130, flag: 'HIGH' },

    // Advanced Lipids - CardioIQ
    { marker_name: 'ApoB', category: 'lipids', value: 96, unit: 'mg/dL', ref_range_high: 90, flag: 'HIGH', athletic_notes: 'Down from 97 in April. Target <80 for E4 carrier.' },
    { marker_name: 'Apolipoprotein A1', category: 'lipids', value: 167, unit: 'mg/dL', ref_range_low: 115, flag: 'NORMAL' },
    { marker_name: 'ApoB/A1 Ratio', category: 'lipids', value: 0.57, unit: 'ratio', ref_range_high: 0.77, flag: 'NORMAL', athletic_notes: 'Optimal ratio' },
    { marker_name: 'LDL Particle Number', category: 'lipids', value: 1306, unit: 'nmol/L', ref_range_high: 1138, flag: 'HIGH', athletic_notes: 'SIGNIFICANT IMPROVEMENT from 1863 in April! Down 30%.' },
    { marker_name: 'LDL Small', category: 'lipids', value: 246, unit: 'nmol/L', ref_range_high: 142, flag: 'HIGH', athletic_notes: 'Improved from 312 in April' },
    { marker_name: 'LDL Medium', category: 'lipids', value: 353, unit: 'nmol/L', ref_range_high: 215, flag: 'HIGH', athletic_notes: 'Improved from 480 in April' },
    { marker_name: 'HDL Large', category: 'lipids', value: 4574, unit: 'nmol/L', ref_range_low: 6729, flag: 'LOW', athletic_notes: 'Decreased from 4965 in April' },
    { marker_name: 'LDL Pattern', category: 'lipids', value: 1, unit: '', value_text: 'Pattern A', flag: 'NORMAL', athletic_notes: 'IMPROVED to Pattern A (was Pattern B in April)' },
    { marker_name: 'LDL Peak Size', category: 'lipids', value: 218.7, unit: 'Angstrom', ref_range_low: 222.9, flag: 'LOW', athletic_notes: 'Still moderate risk range, same as April' },

    // HDL Function Panel
    { marker_name: 'HDLFX PCEC', category: 'lipids', value: 9.5, unit: '% efflux/4hr', ref_range_low: 8.9, ref_range_high: 14.2, flag: 'NORMAL' },
    { marker_name: 'HDLFX PCAD Score', category: 'lipids', value: 5, unit: '', ref_range_high: 71, flag: 'NORMAL', athletic_notes: 'Excellent - low CAD risk score' },

    // Inflammation
    { marker_name: 'hs-CRP', category: 'inflammation', value: 0.2, unit: 'mg/L', ref_range_high: 1.0, flag: 'NORMAL', athletic_notes: 'Excellent, consistent with April' },
    { marker_name: 'LP PLA2 Activity', category: 'inflammation', value: 128, unit: 'nmol/min/mL', ref_range_high: 123, flag: 'HIGH', athletic_notes: 'Slightly elevated - vascular inflammation marker' },
    { marker_name: 'OxLDL', category: 'inflammation', value: 54, unit: 'U/L', ref_range_high: 60, flag: 'NORMAL', athletic_notes: 'Excellent oxidized LDL level' },
    { marker_name: 'Myeloperoxidase', category: 'inflammation', value: 294, unit: 'pmol/L', ref_range_high: 470, flag: 'NORMAL', athletic_notes: 'Low plaque rupture risk' },
    { marker_name: 'Fibrinogen', category: 'inflammation', value: 228, unit: 'mg/dL', ref_range_low: 180, ref_range_high: 350, flag: 'NORMAL' },
    { marker_name: 'TMAO', category: 'inflammation', value: 3.3, unit: 'uM', ref_range_high: 6.2, flag: 'NORMAL', athletic_notes: 'Excellent gut-heart axis marker' },

    // Metabolic
    { marker_name: 'Glucose, Fasting', category: 'metabolic', value: 93, unit: 'mg/dL', ref_range_low: 65, ref_range_high: 99, flag: 'NORMAL', athletic_notes: 'Slightly up from 88 in April, still excellent' },
    { marker_name: 'HbA1c', category: 'metabolic', value: 5.1, unit: '%', ref_range_high: 5.7, flag: 'NORMAL', athletic_notes: 'Excellent, up slightly from 5.0' },
    { marker_name: 'Insulin, Fasting', category: 'metabolic', value: 2.7, unit: 'uIU/mL', ref_range_high: 18.4, flag: 'NORMAL', athletic_notes: 'EXCELLENT - down from 5.2 in April. Superior insulin sensitivity.' },
    { marker_name: 'Insulin, Intact, LC/MS/MS', category: 'metabolic', value: 3, unit: 'uIU/mL', ref_range_high: 16, flag: 'NORMAL' },
    { marker_name: 'C-Peptide', category: 'metabolic', value: 0.52, unit: 'ng/mL', ref_range_low: 0.68, ref_range_high: 2.16, flag: 'LOW', athletic_notes: 'Below range - consistent with very low insulin production (efficient metabolism)' },
    { marker_name: 'Insulin Resistance Score', category: 'metabolic', value: 2, unit: '', ref_range_high: 33, flag: 'NORMAL', athletic_notes: 'Excellent - highly insulin sensitive' },
    { marker_name: 'Adiponectin', category: 'metabolic', value: 17.2, unit: 'ug/mL', flag: 'NORMAL', athletic_notes: 'High adiponectin is protective' },

    // Liver
    { marker_name: 'ALT', category: 'liver', value: 22, unit: 'U/L', ref_range_low: 9, ref_range_high: 46, flag: 'NORMAL' },
    { marker_name: 'AST', category: 'liver', value: 26, unit: 'U/L', ref_range_low: 10, ref_range_high: 40, flag: 'NORMAL' },
    { marker_name: 'Alkaline Phosphatase', category: 'liver', value: 89, unit: 'U/L', ref_range_low: 36, ref_range_high: 130, flag: 'NORMAL' },
    { marker_name: 'Bilirubin, Total', category: 'liver', value: 0.7, unit: 'mg/dL', ref_range_low: 0.2, ref_range_high: 1.2, flag: 'NORMAL' },

    // Kidney
    { marker_name: 'BUN', category: 'kidney', value: 14, unit: 'mg/dL', ref_range_low: 7, ref_range_high: 25, flag: 'NORMAL' },
    { marker_name: 'Creatinine', category: 'kidney', value: 0.96, unit: 'mg/dL', ref_range_low: 0.60, ref_range_high: 1.26, flag: 'NORMAL' },
    { marker_name: 'eGFR', category: 'kidney', value: 104, unit: 'mL/min/1.73m2', ref_range_low: 60, flag: 'NORMAL' },
    { marker_name: 'Cystatin C', category: 'kidney', value: 0.81, unit: 'mg/L', ref_range_low: 0.52, ref_range_high: 1.31, flag: 'NORMAL' },
    { marker_name: 'eGFR (Cystatin C)', category: 'kidney', value: 113, unit: 'mL/min/1.73m2', ref_range_low: 60, flag: 'NORMAL' },

    // Electrolytes
    { marker_name: 'Sodium', category: 'electrolytes', value: 136, unit: 'mmol/L', ref_range_low: 135, ref_range_high: 146, flag: 'NORMAL' },
    { marker_name: 'Potassium', category: 'electrolytes', value: 4.6, unit: 'mmol/L', ref_range_low: 3.5, ref_range_high: 5.3, flag: 'NORMAL' },
    { marker_name: 'Chloride', category: 'electrolytes', value: 100, unit: 'mmol/L', ref_range_low: 98, ref_range_high: 110, flag: 'NORMAL' },
    { marker_name: 'CO2', category: 'electrolytes', value: 30, unit: 'mmol/L', ref_range_low: 20, ref_range_high: 32, flag: 'NORMAL' },
    { marker_name: 'Calcium', category: 'electrolytes', value: 9.9, unit: 'mg/dL', ref_range_low: 8.6, ref_range_high: 10.3, flag: 'NORMAL' },

    // Proteins
    { marker_name: 'Protein, Total', category: 'metabolic', value: 7.8, unit: 'g/dL', ref_range_low: 6.1, ref_range_high: 8.1, flag: 'NORMAL' },
    { marker_name: 'Albumin', category: 'metabolic', value: 5.0, unit: 'g/dL', ref_range_low: 3.6, ref_range_high: 5.1, flag: 'NORMAL' },
    { marker_name: 'Globulin', category: 'metabolic', value: 2.8, unit: 'g/dL', ref_range_low: 1.9, ref_range_high: 3.7, flag: 'NORMAL' },

    // Hormones
    { marker_name: 'SHBG', category: 'hormones', value: 62, unit: 'nmol/L', ref_range_low: 10, ref_range_high: 50, flag: 'HIGH', athletic_notes: 'Up from 59 in April. Common in endurance athletes.' },
    { marker_name: 'Cortisol, Total, LC/MS', category: 'hormones', value: 10.9, unit: 'mcg/dL', ref_range_low: 4.6, ref_range_high: 20.6, flag: 'NORMAL', athletic_notes: 'Normal AM cortisol, down from 15.2 in April' },

    // Vitamins
    { marker_name: 'Vitamin D, 25-Hydroxy', category: 'vitamins', value: 38, unit: 'ng/mL', ref_range_low: 30, ref_range_high: 100, flag: 'NORMAL', athletic_notes: 'Same as April. Optimal for athletes is 40-60.' },

    // Blood Count
    { marker_name: 'WBC', category: 'blood', value: 6.0, unit: 'K/uL', ref_range_low: 3.8, ref_range_high: 10.8, flag: 'NORMAL' },
    { marker_name: 'RBC', category: 'blood', value: 5.45, unit: 'M/uL', ref_range_low: 4.20, ref_range_high: 5.80, flag: 'NORMAL', athletic_notes: 'Up from 4.89 in April' },
    { marker_name: 'Hemoglobin', category: 'blood', value: 17.2, unit: 'g/dL', ref_range_low: 13.2, ref_range_high: 17.1, flag: 'HIGH', athletic_notes: 'UP from 15.3 in April. Significant increase in oxygen carrying capacity!' },
    { marker_name: 'Hematocrit', category: 'blood', value: 49.9, unit: '%', ref_range_low: 38.5, ref_range_high: 50.0, flag: 'NORMAL', athletic_notes: 'Up from 44.8 in April - at top of range' },
    { marker_name: 'MCV', category: 'blood', value: 91.6, unit: 'fL', ref_range_low: 80.0, ref_range_high: 100.0, flag: 'NORMAL' },
    { marker_name: 'MCH', category: 'blood', value: 31.6, unit: 'pg', ref_range_low: 27.0, ref_range_high: 33.0, flag: 'NORMAL' },
    { marker_name: 'MCHC', category: 'blood', value: 34.5, unit: 'g/dL', ref_range_low: 32.0, ref_range_high: 36.0, flag: 'NORMAL' },
    { marker_name: 'RDW', category: 'blood', value: 12.8, unit: '%', ref_range_low: 11.0, ref_range_high: 15.0, flag: 'NORMAL' },
    { marker_name: 'Platelets', category: 'blood', value: 230, unit: 'K/uL', ref_range_low: 140, ref_range_high: 400, flag: 'NORMAL' },

    // Autoimmune
    { marker_name: 'ANA Screen', category: 'autoimmune', value: 1, unit: '', value_text: 'Positive', flag: 'ABNORMAL', athletic_notes: 'Still positive, consistent with April' },
    { marker_name: 'ANA Titer (Speckled)', category: 'autoimmune', value: 40, unit: 'titer', value_text: '1:40, Nuclear Speckled', flag: 'HIGH' },
    { marker_name: 'ANA Titer (Cytoplasmic)', category: 'autoimmune', value: 40, unit: 'titer', value_text: '1:40, Cytoplasmic', flag: 'HIGH' },
    { marker_name: 'ANA Titer (Nucleolar)', category: 'autoimmune', value: 80, unit: 'titer', value_text: '1:80, Nuclear Nucleolar', flag: 'HIGH', athletic_notes: 'Multiple patterns at low titers - monitor but likely benign' },

    // Allergies (Total IgE and key allergens)
    { marker_name: 'Immunoglobulin E, Total', category: 'allergy', value: 268, unit: 'kU/L', ref_range_high: 114, flag: 'HIGH', athletic_notes: 'Elevated total IgE indicates allergic sensitization' },
    { marker_name: 'Alternaria (Mold) IgE', category: 'allergy', value: 6.77, unit: 'kU/L', value_text: 'Class 3 - High', flag: 'HIGH', athletic_notes: 'Significant mold allergy - may affect outdoor training' },
    { marker_name: 'Timothy Grass IgE', category: 'allergy', value: 4.36, unit: 'kU/L', value_text: 'Class 3 - High', flag: 'HIGH', athletic_notes: 'Grass allergy - relevant for outdoor running' },
    { marker_name: 'Oak IgE', category: 'allergy', value: 4.15, unit: 'kU/L', value_text: 'Class 3 - High', flag: 'HIGH' },
    { marker_name: 'Alder IgE', category: 'allergy', value: 4.11, unit: 'kU/L', value_text: 'Class 3 - High', flag: 'HIGH' },
    { marker_name: 'Johnson Grass IgE', category: 'allergy', value: 0.89, unit: 'kU/L', value_text: 'Class 2 - Moderate', flag: 'HIGH' },
    { marker_name: 'Bermuda Grass IgE', category: 'allergy', value: 0.78, unit: 'kU/L', value_text: 'Class 2 - Moderate', flag: 'HIGH' },
    { marker_name: 'Mountain Cedar IgE', category: 'allergy', value: 0.56, unit: 'kU/L', value_text: 'Class 1 - Low', flag: 'HIGH' },
  ]
};

async function main() {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';
  console.log(`Database: ${dbPath}`);
  initializeDb(dbPath);

  console.log('\nImporting October 2025 bloodwork...\n');

  // Import panel
  const panelId = importLabPanel(october31Panel);

  // Generate insights
  console.log('\nGenerating insights...\n');

  // LDL Particle Improvement - GREAT NEWS
  importInsight(panelId, {
    insight_type: 'monitoring',
    category: 'cardiovascular',
    title: 'Significant LDL Particle Improvement',
    summary: 'LDL particle number dropped 30% from 1863 to 1306 since April. LDL pattern improved from B to A. Whatever interventions were made are working.',
    details: `Lipid Changes April → October 2025:
- LDL-P: 1863 → 1306 nmol/L (↓30% - major improvement!)
- LDL Small: 312 → 246 nmol/L (↓21%)
- LDL Medium: 480 → 353 nmol/L (↓26%)
- LDL Pattern: B → A (improved to less atherogenic pattern)
- ApoB: 97 → 96 mg/dL (stable)
- LDL-C: 123 → 123 mg/dL (unchanged)

Key observations:
- LDL-C staying stable while particle count drops significantly is ideal
- Pattern A shift indicates larger, less dangerous particles
- Continue current interventions (diet, exercise, supplements?)

Still elevated but trending in right direction. Continue monitoring.`,
    related_markers: ['LDL Particle Number', 'LDL Small', 'LDL Medium', 'LDL Pattern', 'ApoB'],
    confidence: 'high',
    action_recommended: 'Continue current interventions. Retest in 6 months to confirm trend.',
    urgency: 'informational'
  });

  // Hemoglobin increase - training adaptation
  importInsight(panelId, {
    insight_type: 'training_impact',
    category: 'performance',
    title: 'Significant Hemoglobin Increase - Enhanced Oxygen Capacity',
    summary: 'Hemoglobin increased from 15.3 to 17.2 g/dL (+12%). This represents a major improvement in oxygen-carrying capacity for endurance performance.',
    details: `Blood Changes April → October 2025:
- Hemoglobin: 15.3 → 17.2 g/dL (+12%)
- Hematocrit: 44.8% → 49.9% (+11%)
- RBC: 4.89 → 5.45 M/uL (+11%)

This could indicate:
1. Training adaptation (altitude training, increased volume)
2. Improved iron utilization
3. Natural variation/hydration status

Impact on running:
- Significantly improved oxygen delivery to muscles
- Better endurance capacity
- May notice improved performance at threshold

Note: Hemoglobin slightly above reference (17.1). If continues to rise, worth checking with physician to rule out polycythemia.`,
    related_markers: ['Hemoglobin', 'Hematocrit', 'RBC'],
    confidence: 'high',
    action_recommended: 'Monitor at next labs. If continues above range, discuss with physician.',
    urgency: 'informational'
  });

  // Metabolic excellence
  importInsight(panelId, {
    insight_type: 'monitoring',
    category: 'metabolic',
    title: 'Superior Insulin Sensitivity - Metabolic Optimization',
    summary: 'Fasting insulin dropped from 5.2 to 2.7 uIU/mL. Insulin resistance score of 2 is exceptional. Metabolic health continues to improve.',
    details: `Metabolic Changes April → October 2025:
- Fasting Insulin: 5.2 → 2.7 uIU/mL (↓48%)
- Insulin Resistance Score: 2 (optimal <33)
- C-Peptide: 0.52 ng/mL (below range - very low insulin production needed)
- Glucose: 88 → 93 mg/dL (slight increase but still excellent)
- HbA1c: 5.0% → 5.1% (stable, excellent)

This profile indicates:
- Exceptional insulin sensitivity
- Highly efficient glucose metabolism
- Well-adapted to fat oxidation
- Low metabolic disease risk

Very low C-peptide with normal glucose suggests your pancreas doesn't need to produce much insulin to maintain glucose control - sign of metabolic efficiency.`,
    related_markers: ['Insulin, Fasting', 'Insulin Resistance Score', 'C-Peptide', 'Glucose, Fasting', 'HbA1c'],
    confidence: 'high',
    action_recommended: 'Maintain current diet and exercise approach. Annual monitoring sufficient.',
    urgency: 'informational'
  });

  // LP-PLA2 elevation
  importInsight(panelId, {
    insight_type: 'monitoring',
    category: 'cardiovascular',
    title: 'LP-PLA2 Activity Slightly Elevated',
    summary: 'LP-PLA2 activity 128 nmol/min/mL is slightly above optimal (≤123). This is a vascular-specific inflammation marker worth monitoring.',
    details: `LP-PLA2 (Lipoprotein-associated phospholipase A2):
- Result: 128 nmol/min/mL
- Optimal: ≤123 nmol/min/mL
- High risk: >123 nmol/min/mL

LP-PLA2 is produced by inflammatory cells in arterial plaque. Elevation may indicate:
- Active plaque inflammation
- Early atherosclerotic process

However, context matters:
- hs-CRP is excellent (0.2 mg/L)
- OxLDL is optimal (54 U/L)
- Myeloperoxidase is optimal (294 pmol/L)
- TMAO is optimal (3.3 uM)
- pCAD score is excellent (5)

The isolated LP-PLA2 elevation with all other inflammatory markers optimal suggests this may not be clinically significant. Continue monitoring.`,
    related_markers: ['LP PLA2 Activity', 'hs-CRP', 'OxLDL', 'Myeloperoxidase', 'TMAO'],
    confidence: 'moderate',
    action_recommended: 'Monitor at next labs. If persistent elevation with other markers, discuss with cardiologist.',
    urgency: 'routine'
  });

  // Allergy findings - NEW
  importInsight(panelId, {
    insight_type: 'training_impact',
    category: 'performance',
    title: 'Environmental Allergies May Affect Training',
    summary: 'Significant allergies to mold (Alternaria), grasses (Timothy, Bermuda), and trees (Oak, Alder) identified. Total IgE elevated at 268.',
    details: `Allergy Profile:
High (Class 3):
- Alternaria alternata (mold): 6.77 kU/L
- Timothy Grass: 4.36 kU/L
- Oak: 4.15 kU/L
- Alder: 4.11 kU/L

Moderate (Class 2):
- Johnson Grass: 0.89 kU/L
- Bermuda Grass: 0.78 kU/L

Training Implications:
- Mold allergy (Alternaria) may worsen symptoms after rain or in humid conditions
- Grass allergies peak spring/summer
- Tree allergies peak spring
- Consider antihistamine before outdoor training during high pollen days
- May explain any respiratory symptoms during certain seasons

Recommendations:
- Check local pollen counts before outdoor runs
- Consider early morning runs when pollen lower
- Shower/change clothes after outdoor training
- Discuss with allergist if symptoms impact training`,
    related_markers: ['Immunoglobulin E, Total', 'Alternaria (Mold) IgE', 'Timothy Grass IgE', 'Oak IgE'],
    confidence: 'high',
    action_recommended: 'Monitor symptoms during high pollen seasons. Consider allergist consultation if training affected.',
    urgency: 'routine'
  });

  // Summary counts
  const db = (await import('../src/db/client.js')).getDb();

  const panelCount = db.prepare('SELECT COUNT(*) as count FROM lab_panels').get() as { count: number };
  const resultCount = db.prepare('SELECT COUNT(*) as count FROM biomarker_results').get() as { count: number };
  const insightCount = db.prepare('SELECT COUNT(*) as count FROM biomarker_insights').get() as { count: number };

  console.log('\n' + '═'.repeat(50));
  console.log('  Import Summary');
  console.log('═'.repeat(50));
  console.log(`  Lab Panels:        ${panelCount.count}`);
  console.log(`  Biomarker Results: ${resultCount.count}`);
  console.log(`  Insights:          ${insightCount.count}`);
  console.log('═'.repeat(50));

  closeDb();
  console.log('\nDone!');
}

main().catch(console.error);

-- Migration: 002_biomarkers
-- Description: Add tables for tracking bloodwork and biomarker results
--
-- This enables the coach to reference lab values when making training decisions,
-- such as considering iron status for fatigue, vitamin D for injury risk,
-- inflammation markers for recovery capacity, etc.

-- ===========================================
-- LAB PANELS: Group tests from same blood draw
-- ===========================================
CREATE TABLE IF NOT EXISTS lab_panels (
    id TEXT PRIMARY KEY,
    collection_date TEXT NOT NULL,          -- When blood was drawn
    lab_name TEXT,                          -- Quest, LabCorp, etc.
    fasting INTEGER DEFAULT 0,              -- Was this a fasting draw?
    notes TEXT,
    raw_ingest_id TEXT REFERENCES raw_ingest(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS lab_panels_date_idx ON lab_panels(collection_date);

-- ===========================================
-- BIOMARKER RESULTS: Individual test results
-- ===========================================
CREATE TABLE IF NOT EXISTS biomarker_results (
    id TEXT PRIMARY KEY,
    lab_panel_id TEXT NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,

    -- Marker identification
    marker_name TEXT NOT NULL,              -- e.g., "LDL Cholesterol", "Ferritin"
    marker_code TEXT,                       -- Lab code if available
    category TEXT NOT NULL,                 -- hormones, lipids, metabolic, inflammation, vitamins, minerals, thyroid, etc.

    -- Result
    value REAL NOT NULL,
    unit TEXT NOT NULL,                     -- mg/dL, ng/mL, etc.
    value_text TEXT,                        -- For non-numeric results like "Positive", "Negative"

    -- Reference ranges
    ref_range_low REAL,
    ref_range_high REAL,
    ref_range_text TEXT,                    -- For complex ranges like "<100 optimal"

    -- Interpretation
    flag TEXT,                              -- HIGH, LOW, NORMAL, ABNORMAL
    is_critical INTEGER DEFAULT 0,          -- Critical/panic value

    -- Athletic context (optimal ranges may differ from "normal")
    athletic_optimal_low REAL,              -- Optimal for endurance athletes
    athletic_optimal_high REAL,
    athletic_notes TEXT,                    -- Athletic-specific interpretation

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS biomarker_results_panel_idx ON biomarker_results(lab_panel_id);
CREATE INDEX IF NOT EXISTS biomarker_results_marker_idx ON biomarker_results(marker_name);
CREATE INDEX IF NOT EXISTS biomarker_results_category_idx ON biomarker_results(category);

-- ===========================================
-- BIOMARKER INSIGHTS: Coach-generated analysis
-- ===========================================
CREATE TABLE IF NOT EXISTS biomarker_insights (
    id TEXT PRIMARY KEY,
    lab_panel_id TEXT NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,

    insight_type TEXT NOT NULL,             -- training_impact, health_risk, optimization, monitoring
    category TEXT NOT NULL,                 -- cardiovascular, metabolic, recovery, performance, etc.
    title TEXT NOT NULL,                    -- Brief title
    summary TEXT NOT NULL,                  -- Key insight
    details TEXT,                           -- Full analysis

    -- Evidence linking
    related_markers TEXT,                   -- JSON array of marker names that support this insight
    confidence TEXT DEFAULT 'moderate',     -- high, moderate, low

    -- Actionability
    action_recommended TEXT,                -- What to do about it
    urgency TEXT DEFAULT 'routine',         -- urgent, soon, routine, informational
    follow_up_date TEXT,                    -- When to retest or follow up

    -- Status
    status TEXT DEFAULT 'active',           -- active, addressed, monitoring, dismissed
    addressed_at TEXT,
    addressed_notes TEXT,

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS biomarker_insights_panel_idx ON biomarker_insights(lab_panel_id);
CREATE INDEX IF NOT EXISTS biomarker_insights_type_idx ON biomarker_insights(insight_type);
CREATE INDEX IF NOT EXISTS biomarker_insights_status_idx ON biomarker_insights(status);

-- ===========================================
-- BIOMARKER REFERENCE: Athletic reference ranges
-- ===========================================
-- This table stores optimal ranges for endurance athletes
-- which often differ from standard clinical ranges
CREATE TABLE IF NOT EXISTS biomarker_reference (
    marker_name TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    standard_unit TEXT NOT NULL,

    -- Standard clinical ranges
    clinical_low REAL,
    clinical_high REAL,

    -- Athletic optimal ranges
    athletic_optimal_low REAL,
    athletic_optimal_high REAL,

    -- Context
    description TEXT,                       -- What this marker measures
    athletic_relevance TEXT,                -- Why it matters for runners
    low_symptoms TEXT,                      -- Symptoms when too low
    high_symptoms TEXT,                     -- Symptoms when too high

    -- Training implications
    training_impact TEXT,                   -- How it affects training/recovery
    optimization_notes TEXT                 -- How to optimize
);

-- Insert athletic reference ranges for common markers
INSERT OR IGNORE INTO biomarker_reference (marker_name, category, standard_unit, clinical_low, clinical_high, athletic_optimal_low, athletic_optimal_high, description, athletic_relevance, training_impact) VALUES
    -- Iron/Oxygen Transport
    ('Ferritin', 'minerals', 'ng/mL', 12, 150, 50, 150, 'Iron storage protein', 'Critical for oxygen transport and energy production', 'Low ferritin causes fatigue, poor recovery, decreased performance'),
    ('Iron', 'minerals', 'mcg/dL', 60, 170, 80, 150, 'Serum iron', 'Essential for hemoglobin production', 'Low iron impairs oxygen delivery to muscles'),
    ('Hemoglobin', 'blood', 'g/dL', 13.5, 17.5, 14.5, 17.0, 'Oxygen-carrying protein in red blood cells', 'Directly affects oxygen delivery capacity', 'Low hemoglobin = reduced endurance capacity'),

    -- Hormones
    ('Testosterone, Total', 'hormones', 'ng/dL', 264, 916, 500, 900, 'Primary male sex hormone', 'Supports muscle repair, recovery, and adaptation', 'Low T impairs recovery and training adaptation'),
    ('Cortisol', 'hormones', 'mcg/dL', 6, 23, 10, 18, 'Stress hormone', 'Indicator of training stress and recovery', 'Chronically elevated = overtraining; too low = adrenal fatigue'),
    ('Vitamin D, 25-Hydroxy', 'vitamins', 'ng/mL', 30, 100, 40, 60, 'Fat-soluble vitamin/hormone', 'Bone health, immune function, muscle function', 'Low D associated with stress fractures and poor immunity'),

    -- Thyroid
    ('TSH', 'thyroid', 'mIU/L', 0.45, 4.5, 1.0, 2.5, 'Thyroid stimulating hormone', 'Regulates metabolism and energy', 'Abnormal TSH affects energy, recovery, and weight'),
    ('Free T4', 'thyroid', 'ng/dL', 0.8, 1.8, 1.0, 1.5, 'Active thyroid hormone', 'Controls metabolic rate', 'Low T4 causes fatigue and slow recovery'),

    -- Inflammation
    ('hs-CRP', 'inflammation', 'mg/L', 0, 3, 0, 1, 'High-sensitivity C-reactive protein', 'Marker of systemic inflammation', 'Elevated after hard training; chronically high indicates overreaching'),
    ('Homocysteine', 'inflammation', 'umol/L', 0, 15, 0, 10, 'Amino acid, cardiovascular marker', 'Cardiovascular health indicator', 'High levels associated with increased CVD risk'),

    -- Lipids
    ('LDL Cholesterol', 'lipids', 'mg/dL', 0, 100, 0, 100, 'Low-density lipoprotein', 'Cardiovascular risk marker', 'Exercise typically improves lipid profile'),
    ('HDL Cholesterol', 'lipids', 'mg/dL', 40, 200, 50, 200, 'High-density lipoprotein', 'Protective cardiovascular marker', 'Endurance training typically raises HDL'),
    ('Triglycerides', 'lipids', 'mg/dL', 0, 150, 0, 100, 'Blood fat', 'Metabolic health indicator', 'Low triglycerides indicate good metabolic efficiency'),
    ('ApoB', 'lipids', 'mg/dL', 0, 100, 0, 80, 'Apolipoprotein B', 'Better CVD risk predictor than LDL-C', 'Number of atherogenic particles'),

    -- Metabolic
    ('Glucose, Fasting', 'metabolic', 'mg/dL', 70, 100, 70, 90, 'Blood sugar', 'Metabolic health indicator', 'Well-trained athletes often have excellent glucose control'),
    ('HbA1c', 'metabolic', '%', 0, 5.7, 0, 5.3, 'Average blood sugar over 3 months', 'Long-term glucose control', 'Low HbA1c indicates metabolic efficiency'),
    ('Insulin', 'metabolic', 'uIU/mL', 2, 19, 2, 8, 'Hormone regulating blood sugar', 'Metabolic health and insulin sensitivity', 'Low fasting insulin indicates good insulin sensitivity'),

    -- Kidney/Muscle
    ('Creatinine', 'metabolic', 'mg/dL', 0.7, 1.3, 0.9, 1.3, 'Muscle metabolism byproduct', 'Kidney function marker', 'Can be elevated in muscular athletes'),
    ('BUN', 'metabolic', 'mg/dL', 7, 20, 10, 20, 'Blood urea nitrogen', 'Protein metabolism/kidney function', 'Can be elevated with high protein intake'),

    -- Electrolytes
    ('Sodium', 'electrolytes', 'mmol/L', 136, 145, 138, 142, 'Primary electrolyte', 'Fluid balance and nerve function', 'Critical for endurance performance'),
    ('Potassium', 'electrolytes', 'mmol/L', 3.5, 5.0, 4.0, 4.8, 'Key electrolyte', 'Muscle and nerve function', 'Important for preventing cramps'),
    ('Magnesium', 'electrolytes', 'mg/dL', 1.7, 2.2, 2.0, 2.2, 'Essential mineral', 'Muscle function, energy production', 'Depleted by heavy sweating');

-- ===========================================
-- VIEWS for biomarker analysis
-- ===========================================

-- Latest results for each marker
CREATE VIEW IF NOT EXISTS v_latest_biomarkers AS
SELECT
    br.*,
    lp.collection_date,
    lp.lab_name,
    bref.athletic_optimal_low,
    bref.athletic_optimal_high,
    bref.athletic_relevance,
    bref.training_impact
FROM biomarker_results br
JOIN lab_panels lp ON br.lab_panel_id = lp.id
LEFT JOIN biomarker_reference bref ON br.marker_name = bref.marker_name
WHERE lp.collection_date = (
    SELECT MAX(lp2.collection_date)
    FROM lab_panels lp2
    JOIN biomarker_results br2 ON lp2.id = br2.lab_panel_id
    WHERE br2.marker_name = br.marker_name
);

-- Out of range markers
CREATE VIEW IF NOT EXISTS v_biomarker_flags AS
SELECT
    br.*,
    lp.collection_date,
    bref.athletic_optimal_low,
    bref.athletic_optimal_high,
    CASE
        WHEN br.flag IN ('HIGH', 'LOW', 'ABNORMAL') THEN 'clinical_flag'
        WHEN bref.athletic_optimal_low IS NOT NULL AND br.value < bref.athletic_optimal_low THEN 'below_athletic_optimal'
        WHEN bref.athletic_optimal_high IS NOT NULL AND br.value > bref.athletic_optimal_high THEN 'above_athletic_optimal'
        ELSE 'optimal'
    END as athletic_status
FROM biomarker_results br
JOIN lab_panels lp ON br.lab_panel_id = lp.id
LEFT JOIN biomarker_reference bref ON br.marker_name = bref.marker_name
WHERE br.flag IN ('HIGH', 'LOW', 'ABNORMAL')
   OR (bref.athletic_optimal_low IS NOT NULL AND br.value < bref.athletic_optimal_low)
   OR (bref.athletic_optimal_high IS NOT NULL AND br.value > bref.athletic_optimal_high);

-- Active insights
CREATE VIEW IF NOT EXISTS v_active_biomarker_insights AS
SELECT
    bi.*,
    lp.collection_date
FROM biomarker_insights bi
JOIN lab_panels lp ON bi.lab_panel_id = lp.id
WHERE bi.status = 'active'
ORDER BY
    CASE bi.urgency
        WHEN 'urgent' THEN 1
        WHEN 'soon' THEN 2
        WHEN 'routine' THEN 3
        ELSE 4
    END,
    lp.collection_date DESC;

-- Record schema version
INSERT OR IGNORE INTO schema_versions (version, description)
VALUES ('1.1.0', 'Add biomarker tracking tables');

-- MediConnect / MediGuide production schema
-- Run this file in MySQL before enabling MYSQL_ENABLED=true.

CREATE DATABASE IF NOT EXISTS mediconnect
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mediconnect;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(32) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('patient','doctor','hospital','clinic','ngo','admin','super_admin') NOT NULL DEFAULT 'patient',
  provider_id CHAR(36) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_provider (provider_id)
);

CREATE TABLE IF NOT EXISTS providers (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  name VARCHAR(200) NOT NULL,
  type ENUM('Doctor','Hospital','Clinic','NGO') NOT NULL,
  speciality VARCHAR(180) NOT NULL,
  registration_number VARCHAR(120) NOT NULL,
  experience_years DECIMAL(5,2) NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(190) NOT NULL,
  website VARCHAR(255) NULL,
  address TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(12) NOT NULL,
  consultation_mode VARCHAR(100) NULL,
  working_hours VARCHAR(255) NULL,
  languages JSON NULL,
  about TEXT NULL,
  allow_calls BOOLEAN NOT NULL DEFAULT TRUE,
  allow_messages BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('Pending','Submitted','Under Review','Verified','Correction Required','Rejected','Suspended') NOT NULL DEFAULT 'Pending',
  ai_verification_status ENUM('not_run','processing','passed','failed','needs_review') NOT NULL DEFAULT 'not_run',
  ai_verification_message TEXT NULL,
  ai_verification_result JSON NULL,
  rejection_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_providers_directory (status, city, speciality, type),
  INDEX idx_providers_registration (registration_number),
  CONSTRAINT fk_provider_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS provider_documents (
  id CHAR(36) PRIMARY KEY,
  provider_id CHAR(36) NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  status ENUM('Pending','Under Review','Verified','Rejected','Correction Required') NOT NULL DEFAULT 'Pending',
  ai_status ENUM('not_run','processing','passed','failed','needs_review') NOT NULL DEFAULT 'not_run',
  ai_message TEXT NULL,
  ai_result JSON NULL,
  reviewer_id CHAR(36) NULL,
  reviewer_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  CONSTRAINT fk_document_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  CONSTRAINT fk_document_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_documents_review (status, created_at)
);

CREATE TABLE IF NOT EXISTS faqs (
  id CHAR(36) PRIMARY KEY,
  question VARCHAR(500) NOT NULL,
  answer TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_faq_public (is_published, category, sort_order)
);

CREATE TABLE IF NOT EXISTS myth_facts (
  id CHAR(36) PRIMARY KEY,
  myth TEXT NOT NULL,
  fact TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by CHAR(36) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_myth_public (is_published, category, sort_order)
);

CREATE TABLE IF NOT EXISTS health_issues (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  region VARCHAR(100) NULL,
  symptoms JSON NOT NULL,
  details TEXT NULL,
  severity ENUM('Mild','Moderate','Severe') NOT NULL,
  duration VARCHAR(80) NOT NULL,
  recommended_speciality VARCHAR(180) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_issues_user (user_id, created_at),
  CONSTRAINT fk_issue_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wellness_assessments (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  answers JSON NOT NULL,
  probabilities JSON NOT NULL,
  dimensions JSON NOT NULL,
  primary_pattern VARCHAR(80) NOT NULL,
  score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assessment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_assessment_user (user_id, created_at),
  INDEX idx_assessment_pattern (primary_pattern, created_at)
);

CREATE TABLE IF NOT EXISTS consultation_requests (
  id CHAR(36) PRIMARY KEY,
  patient_id CHAR(36) NOT NULL,
  provider_id CHAR(36) NOT NULL,
  health_issue_id CHAR(36) NULL,
  preferred_channel ENUM('call','whatsapp','message') NOT NULL,
  message TEXT NULL,
  status ENUM('requested','accepted','declined','completed','cancelled') NOT NULL DEFAULT 'requested',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_consult_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_consult_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  CONSTRAINT fk_consult_issue FOREIGN KEY (health_issue_id) REFERENCES health_issues(id) ON DELETE SET NULL,
  INDEX idx_consult_provider_status (provider_id, status, created_at),
  INDEX idx_consult_patient_status (patient_id, status, created_at)
);

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) PRIMARY KEY,
  consultation_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  sender_role VARCHAR(40) NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_message_consultation FOREIGN KEY (consultation_id) REFERENCES consultation_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_messages_conversation (consultation_id, created_at)
);

CREATE TABLE IF NOT EXISTS feedback (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  provider_id CHAR(36) NULL,
  rating TINYINT UNSIGNED NULL,
  category VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new','in_review','resolved','archived') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_feedback_rating CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_feedback_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL,
  INDEX idx_feedback_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS reports (
  id CHAR(36) PRIMARY KEY,
  provider_id CHAR(36) NULL,
  report_type VARCHAR(120) NOT NULL,
  submitted_by VARCHAR(190) NULL,
  submitted_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('new','in_review','resolved','dismissed') NOT NULL DEFAULT 'new',
  details TEXT NULL,
  INDEX idx_reports_status (status, priority, submitted_on),
  CONSTRAINT fk_report_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user (user_id, read_at, created_at)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  admin_id CHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  record_id CHAR(36) NULL,
  record_name VARCHAR(255) NULL,
  remarks TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id CHAR(36) PRIMARY KEY,
  ngo_id CHAR(36) NOT NULL,
  title VARCHAR(220) NOT NULL,
  objective VARCHAR(300) NOT NULL,
  category VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(180) NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NULL,
  contact_phone VARCHAR(32) NULL,
  contact_email VARCHAR(190) NULL,
  website VARCHAR(255) NULL,
  supporting_url VARCHAR(500) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Published',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_campaign_ngo FOREIGN KEY (ngo_id) REFERENCES providers(id) ON DELETE CASCADE,
  INDEX idx_campaign_status_dates (status, start_at, end_at),
  INDEX idx_campaign_ngo (ngo_id)
);

CREATE TABLE IF NOT EXISTS call_requests (
  id CHAR(36) PRIMARY KEY,
  patient_id CHAR(36) NOT NULL,
  provider_id CHAR(36) NOT NULL,
  health_issue_id CHAR(36) NULL,
  patient_phone VARCHAR(32) NULL,
  message TEXT NULL,
  preferred_time VARCHAR(120) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'requested',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_call_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_call_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  CONSTRAINT fk_call_issue FOREIGN KEY (health_issue_id) REFERENCES health_issues(id) ON DELETE SET NULL,
  INDEX idx_call_provider_status (provider_id, status, created_at),
  INDEX idx_call_patient (patient_id, created_at)
);

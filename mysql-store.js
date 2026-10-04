const mysql = require("mysql2/promise");

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mysqlDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date();
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function mysqlNullableDate(value) {
  return value ? mysqlDate(value) : null;
}

function createMySqlStore() {
  const url = process.env.MYSQL_URL;
  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE || "mediconnect";

  if (!url && (!host || !user)) return null;

  const pool = mysql.createPool(url || {
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined
  });

  async function load() {
    const [users] = await pool.query("SELECT id, name, email, phone, password_hash AS passwordHash, role, provider_id AS providerId, created_at AS createdAt FROM users");
    const [providers] = await pool.query("SELECT id, user_id AS userId, name, type, speciality, registration_number AS registrationNumber, experience_years AS experience, phone, email, website, address, city, state, pincode, consultation_mode AS consultationMode, working_hours AS workingHours, languages, about, allow_calls AS allowCalls, allow_messages AS allowMessages, status, ai_verification_status AS aiVerificationStatus, ai_verification_message AS aiVerificationMessage, ai_verification_result AS aiVerificationResult, rejection_reason AS rejectionReason, created_at AS createdAt, updated_at AS updatedAt FROM providers");
    const [documents] = await pool.query("SELECT id, provider_id AS providerId, document_type AS documentType, original_name AS originalName, storage_key AS storedName, mime_type AS mimeType, file_size AS size, status, ai_status AS aiStatus, ai_message AS aiMessage, ai_result AS aiResult, created_at AS createdAt FROM provider_documents");
    const [consultations] = await pool.query("SELECT id, patient_id AS patientId, provider_id AS providerId, health_issue_id AS healthIssueId, preferred_channel AS preferredChannel, message, status, created_at AS createdAt, updated_at AS updatedAt FROM consultation_requests ORDER BY created_at DESC");
    const [messages] = await pool.query("SELECT id, consultation_id AS consultationId, sender_id AS senderId, sender_role AS senderRole, body, read_at AS readAt, created_at AS createdAt FROM messages ORDER BY created_at ASC");
    const [notifications] = await pool.query("SELECT id, user_id AS userId, type, title, message, read_at AS readAt, created_at AS createdAt FROM notifications ORDER BY created_at DESC LIMIT 1000");
    const [healthIssues] = await pool.query("SELECT id, user_id AS userId, region, symptoms, details, severity, duration, recommended_speciality AS recommendedSpeciality, created_at AS createdAt FROM health_issues ORDER BY created_at DESC LIMIT 5000");
    const [wellnessAssessments] = await pool.query("SELECT id, user_id AS userId, answers, probabilities, dimensions, primary_pattern AS primaryPattern, score, created_at AS createdAt FROM wellness_assessments ORDER BY created_at DESC LIMIT 5000");
    const [reports] = await pool.query("SELECT id, provider_id AS providerId, report_type AS reportType, submitted_by AS submittedBy, submitted_on AS submittedOn, priority, status, details FROM reports ORDER BY submitted_on DESC");
    const [auditLogs] = await pool.query("SELECT id, admin_id AS adminId, action, record_id AS recordId, record_name AS recordName, remarks, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC LIMIT 500");
    const [campaigns] = await pool.query("SELECT id, ngo_id AS ngoId, title, objective, category, description, location, start_at AS startAt, end_at AS endAt, contact_phone AS contactPhone, contact_email AS contactEmail, website, supporting_url AS supportingUrl, status, created_at AS createdAt, updated_at AS updatedAt FROM campaigns ORDER BY created_at DESC");
    const [callRequests] = await pool.query("SELECT id, patient_id AS patientId, provider_id AS providerId, health_issue_id AS healthIssueId, patient_phone AS patientPhone, message, preferred_time AS preferredTime, status, created_at AS createdAt, updated_at AS updatedAt FROM call_requests ORDER BY created_at DESC");

    return {
      users,
      campaigns,
      callRequests,
      providers: providers.map((provider) => ({ ...provider, languages: parseJson(provider.languages, []), aiVerificationResult: parseJson(provider.aiVerificationResult, null) })),
      documents: documents.map((document) => ({ ...document, aiResult: parseJson(document.aiResult, null) })),
      consultations,
      messages,
      notifications,
      healthIssues: healthIssues.map((issue) => ({ ...issue, symptoms: parseJson(issue.symptoms, []) })),
      wellnessAssessments: wellnessAssessments.map((assessment) => ({
        ...assessment,
        answers: parseJson(assessment.answers, []),
        probabilities: parseJson(assessment.probabilities, {}),
        dimensions: parseJson(assessment.dimensions, {})
      })),
      reports,
      auditLogs
    };
  }

  async function save(databaseState) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const user of databaseState.users) {
        await connection.query(
          `INSERT INTO users (id, name, email, phone, password_hash, role, provider_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
           ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), password_hash=VALUES(password_hash)`,
          [user.id, user.name, user.email, user.phone || null, user.passwordHash, user.role, mysqlDate(user.createdAt)]
        );
      }

      for (const provider of databaseState.providers) {
        await connection.query(
          `INSERT INTO providers (id, user_id, name, type, speciality, registration_number, experience_years, phone, email, website, address, city, state, pincode, consultation_mode, working_hours, languages, about, allow_calls, allow_messages, status, ai_verification_status, ai_verification_message, ai_verification_result, rejection_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), name=VALUES(name), type=VALUES(type), speciality=VALUES(speciality), registration_number=VALUES(registration_number), experience_years=VALUES(experience_years), phone=VALUES(phone), email=VALUES(email), website=VALUES(website), address=VALUES(address), city=VALUES(city), state=VALUES(state), pincode=VALUES(pincode), consultation_mode=VALUES(consultation_mode), working_hours=VALUES(working_hours), languages=VALUES(languages), about=VALUES(about), allow_calls=VALUES(allow_calls), allow_messages=VALUES(allow_messages), status=VALUES(status), ai_verification_status=VALUES(ai_verification_status), ai_verification_message=VALUES(ai_verification_message), ai_verification_result=VALUES(ai_verification_result), rejection_reason=VALUES(rejection_reason)`,
          [provider.id, provider.userId || null, provider.name, provider.type, provider.speciality, provider.registrationNumber, provider.experience || null, provider.phone, provider.email, provider.website || null, provider.address, provider.city, provider.state, provider.pincode, provider.consultationMode || null, provider.workingHours || null, JSON.stringify(provider.languages || []), provider.about || null, provider.allowCalls !== false, provider.allowMessages !== false, provider.status || "Pending", provider.aiVerificationStatus || "not_run", provider.aiVerificationMessage || null, JSON.stringify(provider.aiVerificationResult || null), provider.rejectionReason || null, mysqlDate(provider.createdAt)]
        );
      }

      for (const user of databaseState.users) {
        await connection.query("UPDATE users SET provider_id=? WHERE id=?", [user.providerId || null, user.id]);
      }

      for (const document of databaseState.documents) {
        await connection.query(
          `INSERT INTO provider_documents (id, provider_id, document_type, original_name, storage_key, mime_type, file_size, status, ai_status, ai_message, ai_result, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status=VALUES(status), ai_status=VALUES(ai_status), ai_message=VALUES(ai_message), ai_result=VALUES(ai_result), reviewer_note=reviewer_note`,
          [document.id, document.providerId, document.documentType, document.originalName, document.storedName, document.mimeType, document.size, document.status || "Pending", document.aiStatus || "not_run", document.aiMessage || null, JSON.stringify(document.aiResult || null), mysqlDate(document.createdAt)]
        );
      }

      for (const consultation of databaseState.consultations || []) {
        await connection.query(
          `INSERT INTO consultation_requests (id, patient_id, provider_id, health_issue_id, preferred_channel, message, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE preferred_channel=VALUES(preferred_channel), message=VALUES(message), status=VALUES(status)`,
          [consultation.id, consultation.patientId, consultation.providerId, consultation.healthIssueId || null, consultation.preferredChannel, consultation.message || null, consultation.status, mysqlDate(consultation.createdAt)]
        );
      }

      for (const campaign of databaseState.campaigns || []) {
        await connection.query(
          `INSERT INTO campaigns (id, ngo_id, title, objective, category, description, location, start_at, end_at, contact_phone, contact_email, website, supporting_url, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE title=VALUES(title), objective=VALUES(objective), category=VALUES(category), description=VALUES(description), location=VALUES(location), start_at=VALUES(start_at), end_at=VALUES(end_at), contact_phone=VALUES(contact_phone), contact_email=VALUES(contact_email), website=VALUES(website), supporting_url=VALUES(supporting_url), status=VALUES(status)`,
          [campaign.id, campaign.ngoId, campaign.title, campaign.objective, campaign.category, campaign.description, campaign.location, mysqlDate(campaign.startAt), mysqlNullableDate(campaign.endAt), campaign.contactPhone || null, campaign.contactEmail || null, campaign.website || null, campaign.supportingUrl || null, campaign.status || "Published", mysqlDate(campaign.createdAt)]
        );
      }

      for (const callRequest of databaseState.callRequests || []) {
        await connection.query(
          `INSERT INTO call_requests (id, patient_id, provider_id, health_issue_id, patient_phone, message, preferred_time, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE patient_phone=VALUES(patient_phone), message=VALUES(message), preferred_time=VALUES(preferred_time), status=VALUES(status)`,
          [callRequest.id, callRequest.patientId, callRequest.providerId, callRequest.healthIssueId || null, callRequest.patientPhone || null, callRequest.message || null, callRequest.preferredTime || null, callRequest.status || "requested", mysqlDate(callRequest.createdAt)]
        );
      }

      for (const message of databaseState.messages || []) {
        await connection.query(
          `INSERT INTO messages (id, consultation_id, sender_id, sender_role, body, read_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE body=VALUES(body), read_at=VALUES(read_at)`,
          [message.id, message.consultationId, message.senderId, message.senderRole, message.body, mysqlNullableDate(message.readAt), mysqlDate(message.createdAt)]
        );
      }

      for (const notification of databaseState.notifications || []) {
        await connection.query(
          `INSERT INTO notifications (id, user_id, type, title, message, read_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE read_at=VALUES(read_at)`,
          [notification.id, notification.userId, notification.type, notification.title, notification.message, mysqlNullableDate(notification.readAt), mysqlDate(notification.createdAt)]
        );
      }

      for (const issue of databaseState.healthIssues || []) {
        await connection.query(
          `INSERT INTO health_issues (id, user_id, region, symptoms, details, severity, duration, recommended_speciality, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE symptoms=VALUES(symptoms), details=VALUES(details), severity=VALUES(severity), duration=VALUES(duration), recommended_speciality=VALUES(recommended_speciality)`,
          [issue.id, issue.userId || null, issue.region, JSON.stringify(issue.symptoms || []), issue.details || null, issue.severity || "Mild", issue.duration || "Not specified", issue.recommendedSpeciality || null, mysqlDate(issue.createdAt)]
        );
      }

      for (const assessment of databaseState.wellnessAssessments || []) {
        await connection.query(
          `INSERT INTO wellness_assessments (id, user_id, answers, probabilities, dimensions, primary_pattern, score, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE answers=VALUES(answers), probabilities=VALUES(probabilities), dimensions=VALUES(dimensions), primary_pattern=VALUES(primary_pattern), score=VALUES(score)`,
          [assessment.id, assessment.userId || null, JSON.stringify(assessment.answers || []), JSON.stringify(assessment.probabilities || {}), JSON.stringify(assessment.dimensions || {}), assessment.primaryPattern || "balanced", assessment.score || 0, mysqlDate(assessment.createdAt)]
        );
      }

      for (const log of databaseState.auditLogs) {
        await connection.query(
          `INSERT INTO audit_logs (id, admin_id, action, record_id, record_name, remarks, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE remarks=VALUES(remarks)`,
          [log.id, log.adminId || null, log.action, log.recordId || null, log.recordName || null, log.remarks || null, mysqlDate(log.createdAt)]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function close() { await pool.end(); }
  return { load, save, close, pool };
}

module.exports = { createMySqlStore };

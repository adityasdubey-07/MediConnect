const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dotenv = require("dotenv");
const { createMySqlStore } = require("./mysql-store");

dotenv.config();

const mysqlStore = createMySqlStore();

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATABASE_FILE = path.join(DATA_DIR, "mediconnect.json");
const DOCUMENT_DIR = path.join(DATA_DIR, "private-documents");
const SESSION_COOKIE = "mediconnect_session";
const SESSION_MAX_AGE = 1000 * 60 * 60 * 12;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DOCUMENT_DIR, { recursive: true });

function emptyDatabase() {
  return {
    users: [],
    providers: [],
    documents: [],
    campaigns: [],
    callRequests: [],
    reports: [],
    consultations: [],
    messages: [],
    notifications: [],
    healthIssues: [],
    wellnessAssessments: [],
    auditLogs: []
  };
}

function loadDatabase() {
  if (!fs.existsSync(DATABASE_FILE)) {
    const initial = emptyDatabase();
    fs.writeFileSync(DATABASE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATABASE_FILE, "utf8"));
    return {
      ...emptyDatabase(),
      ...parsed
    };
  } catch (error) {
    console.error("Database file could not be read:", error.message);
    return emptyDatabase();
  }
}

let database = loadDatabase();
const sessions = new Map();
let mysqlSaveQueue = Promise.resolve();

function saveDatabase() {
  fs.writeFileSync(DATABASE_FILE, JSON.stringify(database, null, 2));

  if (mysqlStore) {
    mysqlSaveQueue = mysqlSaveQueue
      .then(() => mysqlStore.save(database))
      .catch((error) => {
        console.error("Hosted MySQL save failed:", error.message);
      });
  }

  return mysqlSaveQueue;
}

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  // MySQL uses CHAR(36) for primary and foreign keys.
  // Keep the prefix argument for local compatibility, but store a UUID-only ID.
  return crypto.randomUUID();
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  const cookies = {};

  header.split(";").forEach((item) => {
    const index = item.indexOf("=");
    if (index === -1) return;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}${secure}`
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

function getCurrentUser(request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];

  if (!token) return null;

  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  const user = database.users.find((item) => item.id === session.userId);
  return user || null;
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    providerId: user.providerId || null
  };
}

function requireAuth(request, response, next) {
  const user = getCurrentUser(request);

  if (!user) {
    return response.status(401).json({
      message: "Authentication required."
    });
  }

  request.user = user;
  next();
}

function requireAdmin(request, response, next) {
  if (!request.user) {
    return response.status(401).json({
      message: "Authentication required."
    });
  }

  if (!["admin", "super_admin"].includes(request.user.role)) {
    return response.status(403).json({
      message: "Administrator access required."
    });
  }

  next();
}

function requireProvider(request, response, next) {
  if (!request.user) {
    return response.status(401).json({
      message: "Authentication required."
    });
  }

  if (!["doctor", "hospital", "clinic", "ngo"].includes(request.user.role)) {
    return response.status(403).json({
      message: "Provider access required."
    });
  }

  next();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  if (!storedValue || !storedValue.includes(":")) return false;

  const [salt, storedHash] = storedValue.split(":");
  const calculatedHash = crypto.scryptSync(password, salt, 64).toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(storedHash, "hex"),
    Buffer.from(calculatedHash, "hex")
  );
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseLanguages(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parseLanguages(parsed);
  } catch {
    // Comma-separated input is supported below.
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function providerToPublic(provider) {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    speciality: provider.speciality,
    experience: provider.experience,
    city: provider.city,
    state: provider.state,
    pincode: provider.pincode,
    address: provider.address,
    consultationMode: provider.consultationMode,
    workingHours: provider.workingHours,
    languages: provider.languages || [],
    about: provider.about,
    allowCalls: provider.allowCalls,
    allowMessages: provider.allowMessages,
    phone: provider.allowCalls ? provider.phone : null,
    messagePhone: provider.allowMessages ? provider.phone : null,
    website: provider.website,
    status: provider.status
  };
}

function campaignToPublic(campaign) {
  const ngo = database.providers.find((provider) => provider.id === campaign.ngoId);

  return {
    id: campaign.id,
    ngoId: campaign.ngoId,
    ngoName: ngo?.name || "Healthcare NGO",
    title: campaign.title,
    objective: campaign.objective,
    category: campaign.category,
    description: campaign.description,
    location: campaign.location,
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    contactPhone: campaign.contactPhone || null,
    contactEmail: campaign.contactEmail || null,
    website: campaign.website || null,
    supportingUrl: campaign.supportingUrl || null,
    status: campaign.status,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt
  };
}

function callRequestToView(callRequest, user) {
  const provider = database.providers.find((item) => item.id === callRequest.providerId);
  const patient = database.users.find((item) => item.id === callRequest.patientId);
  const isProvider = provider?.userId === user.id;

  return {
    id: callRequest.id,
    providerId: callRequest.providerId,
    providerName: provider?.name || "Provider",
    patientId: isProvider ? callRequest.patientId : undefined,
    patientName: isProvider ? patient?.name || "Patient" : undefined,
    patientPhone: isProvider ? callRequest.patientPhone || patient?.phone || null : undefined,
    message: callRequest.message || "",
    preferredTime: callRequest.preferredTime || "",
    status: callRequest.status,
    createdAt: callRequest.createdAt,
    updatedAt: callRequest.updatedAt
  };
}

function providerToWorkspace(provider) {
  const adminView = providerToAdmin(provider);
  const { documents, documentCount, ...workspaceView } = adminView;
  return workspaceView;
}
function providerToAdmin(provider) {
  const providerDocuments = database.documents.filter(
    (document) => document.providerId === provider.id
  );

  return {
    ...provider,
    documentCount: providerDocuments.length,
    documents: providerDocuments.map((document) => ({
      id: document.id,
      name: document.originalName,
      documentType: document.documentType,
      status: document.status,
      aiStatus: document.aiStatus || "not_run",
      aiMessage: document.aiMessage || "",
      aiResult: document.aiResult || null,
      createdAt: document.createdAt,
      securePreviewUrl: `/api/admin/documents/${document.id}/file`
    }))
  };
}

function createAuditLog(admin, action, recordId, recordName, remarks = "") {
  database.auditLogs.unshift({
    id: createId("log"),
    adminId: admin.id,
    adminName: admin.name || admin.email,
    action,
    recordId,
    recordName,
    remarks,
    createdAt: now()
  });

  database.auditLogs = database.auditLogs.slice(0, 500);
  saveDatabase();
}

function saveUploadedDocuments(files, providerId) {
  const documents = [];

  for (const [fieldName, fileList] of Object.entries(files || {})) {
    for (const file of fileList) {
      const document = {
        id: createId("doc"),
        providerId,
        documentType: fieldName,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        status: "Pending",
        aiStatus: "processing",
        aiMessage: "Automated preliminary screening is pending.",
        aiResult: null,
        createdAt: now()
      };

      database.documents.push(document);
      documents.push(document);
    }
  }

  return documents;
}

async function runDocumentScreening(providerId) {
  const provider = database.providers.find((item) => item.id === providerId);
  const documents = database.documents.filter((item) => item.providerId === providerId);

  if (!provider || !documents.length) return;
  if (!process.env.GEMINI_API_KEY) {
    provider.aiVerificationStatus = "needs_review";
    provider.aiVerificationMessage = "Automated screening is not configured. Administrative verification is required.";
    documents.forEach((document) => {
      document.aiStatus = provider.aiVerificationStatus;
      document.aiMessage = provider.aiVerificationMessage;
      document.aiResult = null;
    });
    saveDatabase();
    return;
  }

  provider.aiVerificationStatus = "processing";
  provider.aiVerificationMessage = "Automated preliminary screening is in progress. Human verification is still required.";
  saveDatabase();

  try {
    const documentParts = documents.slice(0, 4).map((document) => {
      const filePath = path.join(DOCUMENT_DIR, document.storedName);
      const base64 = fs.readFileSync(filePath).toString("base64");
      return {
        inline_data: {
          mime_type: document.mimeType,
          data: base64
        }
      };
    });

    const prompt = `You are performing preliminary document screening for a healthcare provider directory. Review the uploaded document images/PDF representations only for visible consistency signals such as legibility, missing fields, obvious tampering indicators, and whether the document appears to be a professional license or qualification document. Do not claim authenticity, do not make a final fraud determination, and do not verify against a government registry. Return strict JSON with keys: result (one of needs_review, likely_consistent, likely_inconsistent), confidence (number 0 to 1), concerns (array of short strings), summary (short string). Provider type: ${provider.type}. Speciality: ${provider.speciality}. Registration number supplied: ${provider.registrationNumber}.`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.6-flash")}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...documentParts] }] })
    });

    if (!response.ok) throw new Error(`AI screening request failed with status ${response.status}`);
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text || "";
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
    const result = jsonText ? JSON.parse(jsonText) : null;

    provider.aiVerificationStatus = result?.result === "likely_inconsistent" ? "failed" : "passed";
    provider.aiVerificationMessage = "Automated screening is advisory only. An authorized administrator must inspect the documents and confirm the registry details.";
    provider.aiVerificationResult = {
      result: result?.result || "needs_review",
      confidence: Number(result?.confidence || 0),
      concerns: Array.isArray(result?.concerns) ? result.concerns.slice(0, 10) : [],
      summary: String(result?.summary || "No reliable automated summary was returned.")
    };
  } catch (error) {
    provider.aiVerificationStatus = "needs_review";
    provider.aiVerificationMessage = "Automated screening could not be completed. Human verification is required.";
    provider.aiVerificationResult = { result: "needs_review", confidence: 0, concerns: ["AI screening unavailable"], summary: error.message };
  }

  documents.forEach((document) => {
    document.aiStatus = provider.aiVerificationStatus;
    document.aiMessage = provider.aiVerificationMessage;
    document.aiResult = provider.aiVerificationResult || null;
  });

  saveDatabase();
}

function createProviderFromRequest(body, userId = null) {
  const type = String(body.providerType || body.type || "").trim();

  return {
    id: createId("provider"),
    userId,
    name: String(body.providerName || body.name || "").trim(),
    type,
    speciality: String(body.speciality || "").trim(),
    registrationNumber: String(body.registrationNumber || "").trim(),
    experience: String(body.experience || "").trim(),
    phone: String(body.phone || "").trim(),
    email: normalizeEmail(body.email),
    website: String(body.website || "").trim(),
    address: String(body.address || "").trim(),
    city: String(body.city || "").trim(),
    state: String(body.state || "").trim(),
    pincode: String(body.pincode || "").trim(),
    consultationMode: String(body.consultationMode || "Clinic Visit").trim(),
    workingHours: String(body.workingHours || "").trim(),
    languages: parseLanguages(body.languages),
    about: String(body.about || "").trim(),
    allowCalls: body.allowCalls === undefined ? true : parseBoolean(body.allowCalls),
    allowMessages: body.allowMessages === undefined ? true : parseBoolean(body.allowMessages),
    status: "Pending",
    aiVerificationStatus: "not_run",
    aiVerificationMessage: "Documents received. Administrative verification is required before publication.",
    rejectionReason: "",
    createdAt: now(),
    updatedAt: now()
  };
}

function validateProvider(provider) {
  const required = [
    ["name", "Provider name"],
    ["type", "Provider type"],
    ["email", "Email address"],
    ["phone", "Phone number"],
    ["address", "Address"],
    ["city", "City"],
    ["state", "State"],
    ["pincode", "Pincode"]
  ];

  for (const [field, label] of required) {
    if (!provider[field]) {
      return `${label} is required.`;
    }
  }

  if (!provider.email.includes("@")) {
    return "A valid email address is required.";
  }

  return null;
}

function findProviderForUser(user) {
  return database.providers.find((provider) => provider.userId === user.id);
}

function findConsultationForUser(id, user) {
  const consultation = database.consultations.find((item) => item.id === id);
  if (!consultation) return null;

  const provider = database.providers.find((item) => item.id === consultation.providerId);
  const isPatient = consultation.patientId === user.id;
  const isProvider = provider && provider.userId === user.id;
  return isPatient || isProvider ? consultation : null;
}

function createNotification(userId, type, title, message) {
  if (!userId) return;
  database.notifications.unshift({
    id: createId("notification"),
    userId,
    type,
    title,
    message,
    readAt: null,
    createdAt: now()
  });
  database.notifications = database.notifications.slice(0, 1000);
}

function consultationToPrivateView(consultation, user) {
  const provider = database.providers.find((item) => item.id === consultation.providerId);
  const patient = database.users.find((item) => item.id === consultation.patientId);
  const isProvider = provider && provider.userId === user.id;

  return {
    id: consultation.id,
    providerId: consultation.providerId,
    providerName: provider?.name || "Provider",
    patientId: isProvider ? consultation.patientId : undefined,
    patientName: isProvider ? (patient?.name || "Patient") : undefined,
    message: consultation.message || "",
    preferredChannel: consultation.preferredChannel,
    status: consultation.status,
    createdAt: consultation.createdAt,
    updatedAt: consultation.updatedAt
  };
}

function messageToPrivateView(message) {
  return {
    id: message.id,
    consultationId: message.consultationId,
    senderId: message.senderId,
    senderRole: message.senderRole,
    body: message.body,
    createdAt: message.createdAt,
    readAt: message.readAt || null
  };
}

async function bootstrapAdmin() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn("ADMIN_EMAIL and ADMIN_PASSWORD are not set. Admin login is disabled until they are added to .env.");
    return;
  }

  const existing = database.users.find((user) => user.email === email);

  if (!existing) {
    database.users.push({
      id: createId("user"),
      name: "System Administrator",
      email,
      phone: "",
      passwordHash: hashPassword(password),
      role: "admin",
      providerId: null,
      createdAt: now()
    });

    await saveDatabase();
    console.log(`Initial administrator created for ${email}.`);
    return;
  }

  let passwordMatches = false;

  try {
    passwordMatches = verifyPassword(password, existing.passwordHash);
  } catch {
    passwordMatches = false;
  }

  if (!passwordMatches || !["admin", "super_admin"].includes(existing.role)) {
    existing.passwordHash = hashPassword(password);

    if (!["admin", "super_admin"].includes(existing.role)) {
      existing.role = "admin";
    }

    await saveDatabase();
    console.log(`Administrator credentials synchronized for ${email}.`);
  }
}

function parseContentDisposition(value) {
  const result = {};
  const nameMatch = value.match(/name="([^"]*)"/i);
  const fileMatch = value.match(/filename="([^"]*)"/i);

  if (nameMatch) result.name = nameMatch[1];
  if (fileMatch) result.filename = fileMatch[1];

  return result;
}

function parseMultipart(request, response, next) {
  const contentType = request.headers["content-type"] || "";

  if (!contentType.includes("multipart/form-data")) {
    return next();
  }

  const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);

  if (!boundaryMatch) {
    return response.status(400).json({ message: "Multipart boundary is missing." });
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const chunks = [];
  let totalSize = 0;

  request.on("data", (chunk) => {
    totalSize += chunk.length;

    if (totalSize > 30 * 1024 * 1024) {
      request.destroy(new Error("Request is too large."));
      return;
    }

    chunks.push(chunk);
  });

  request.on("error", (error) => next(error));

  request.on("end", () => {
    try {
      const buffer = Buffer.concat(chunks);
      const parts = [];
      let cursor = 0;

      while (cursor < buffer.length) {
        const boundaryStart = buffer.indexOf(boundary, cursor);
        if (boundaryStart === -1) break;

        const partStart = boundaryStart + boundary.length;
        if (buffer.slice(partStart, partStart + 2).toString() === "--") break;

        const contentStart = partStart + 2;
        const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), contentStart);
        if (headerEnd === -1) break;

        const headers = buffer.slice(contentStart, headerEnd).toString("utf8");
        const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
        if (nextBoundary === -1) break;

        const bodyEnd = nextBoundary - 2;
        const body = buffer.slice(headerEnd + 4, bodyEnd);
        parts.push({ headers, body });
        cursor = nextBoundary;
      }

      const fields = {};
      const files = {};

      for (const part of parts) {
        const headerLines = part.headers.split("\r\n");
        const dispositionLine = headerLines.find((line) => line.toLowerCase().startsWith("content-disposition:"));
        const disposition = parseContentDisposition(dispositionLine || "");
        const contentTypeLine = headerLines.find((line) => line.toLowerCase().startsWith("content-type:"));
        const mimeType = contentTypeLine ? contentTypeLine.split(":").slice(1).join(":").trim() : "application/octet-stream";

        if (!disposition.name) continue;

        if (disposition.filename !== undefined) {
          if (!disposition.filename) continue;
          if (part.body.length > MAX_UPLOAD_SIZE) throw new Error("Each uploaded document must be 5 MB or smaller.");

          const extension = path.extname(disposition.filename).toLowerCase();
          if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error("Only PDF, JPG and PNG documents are allowed.");

          const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
          fs.writeFileSync(path.join(DOCUMENT_DIR, storedName), part.body);

          if (!files[disposition.name]) files[disposition.name] = [];
          files[disposition.name].push({
            originalname: path.basename(disposition.filename),
            filename: storedName,
            mimetype: mimeType,
            size: part.body.length
          });
        } else {
          fields[disposition.name] = part.body.toString("utf8");
        }
      }

      request.body = { ...(request.body || {}), ...fields };
      request.files = files;
      next();
    } catch (error) {
      next(error);
    }
  });
}

const providerDocumentFields = parseMultipart;

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Local development support: allow pages opened from localhost or file://
// to call this same local backend while keeping cookies enabled.
app.use((request, response, next) => {
  const origin = request.headers.origin;
  const allowedOrigins = new Set([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "null"
  ]);

  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    response.setHeader("Vary", "Origin");
  }

  if (request.method === "OPTIONS") {
    return response.sendStatus(204);
  }

  next();
});

if (mysqlStore) {
  app.use("/api", async (request, response, next) => {
    try {
      database = await mysqlStore.load();
      next();
    } catch (error) {
      console.error("Hosted MySQL read failed:", error.message);
      response.status(503).json({
        message: "The hosted database is temporarily unavailable."
      });
    }
  });
}

/* Public authentication */

app.post("/api/auth/register", providerDocumentFields, async (request, response) => {
  try {
    const body = request.body || {};
    const accountType = String(body.accountType || "patient").trim().toLowerCase();
    const name = String(body.name || body.providerName || "").trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const phone = String(body.phone || "").trim();

    if (!name || !email || !password) {
      return response.status(400).json({
        message: "Name, email and password are required."
      });
    }

    if (password.length < 8) {
      return response.status(400).json({
        message: "Password must contain at least 8 characters."
      });
    }

    const providerTypes = ["doctor", "hospital", "clinic", "ngo"];
    const isProvider = providerTypes.includes(accountType);
    const existingProvider = isProvider
      ? database.providers.find(
          (provider) =>
            provider.email === email &&
            provider.type.toLowerCase() === (accountType === "doctor" ? "doctor" : accountType)
        )
      : null;

    if (database.users.some((user) => user.email === email)) {
      return response.status(409).json({
        message: "An account with this email already exists."
      });
    }

    const user = {
      id: createId("user"),
      name,
      email,
      phone,
      passwordHash: hashPassword(password),
      role: isProvider ? accountType : "patient",
      providerId: null,
      createdAt: now()
    };

    database.users.push(user);

    if (isProvider && existingProvider) {
      existingProvider.userId = user.id;
      existingProvider.updatedAt = now();
      user.providerId = existingProvider.id;
    } else if (isProvider) {
      const provider = createProviderFromRequest({
        ...body,
        providerType: accountType === "doctor" ? "Doctor" : accountType,
        providerName: name,
        email,
        phone
      }, user.id);

      const validationError = validateProvider(provider);

      if (validationError) {
        database.users = database.users.filter((item) => item.id !== user.id);
        return response.status(400).json({ message: validationError });
      }

      database.providers.push(provider);
      user.providerId = provider.id;
      saveUploadedDocuments(request.files, provider.id);
      runDocumentScreening(provider.id).catch((error) => console.error("Document screening failed:", error.message));
    }

    await saveDatabase();

    response.status(201).json({
      message: isProvider
        ? existingProvider
          ? existingProvider.status === "Verified"
            ? "Provider account created. You can sign in."
            : "Provider account created. Sign-in will be available after administrative verification."
          : "Provider account created and submitted for verification."
        : "Account created successfully.",
      user: publicUser(user)
    });
  } catch (error) {
    console.error("Registration error:", error);
    response.status(500).json({ message: "Registration could not be completed." });
  }
});

app.post("/api/auth/login", (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || "");
  const requestedRole = String(request.body?.role || request.body?.category || "").trim().toLowerCase();
  const user = database.users.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return response.status(401).json({
      message: "The email or password is incorrect."
    });
  }

  const allowedLoginRoles = ["patient", "doctor", "hospital", "clinic", "ngo", "admin", "super_admin"];
  if (requestedRole && (!allowedLoginRoles.includes(requestedRole) || (requestedRole === "admin" && !["admin", "super_admin"].includes(user.role)) || (requestedRole !== "admin" && requestedRole !== user.role))) {
    return response.status(403).json({
      message: "The selected account category does not match this account. Please choose the correct category."
    });
  }

  const providerRoles = ["doctor", "hospital", "clinic", "ngo"];
  if (providerRoles.includes(user.role)) {
    const provider = database.providers.find((item) => item.id === user.providerId);

    if (!provider || provider.status !== "Verified") {
      return response.status(403).json({
        message: "Your provider profile is awaiting administrative verification. Sign-in will be available after approval."
      });
    }
  }

  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    userId: user.id,
    expiresAt: Date.now() + SESSION_MAX_AGE
  });

  setSessionCookie(response, token);

  response.json({
    message: "Signed in successfully.",
    user: publicUser(user)
  });
});

app.post("/api/auth/logout", (request, response) => {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];

  if (token) {
    sessions.delete(token);
  }

  clearSessionCookie(response);
  response.json({ message: "Signed out successfully." });
});

app.get("/api/auth/me", (request, response) => {
  const user = getCurrentUser(request);

  if (!user) {
    return response.status(401).json({
      message: "Not signed in."
    });
  }

  response.json(publicUser(user));
});

/* Public provider directory */

app.get("/api/public/providers", (request, response) => {
  const search = String(request.query.search || "").trim().toLowerCase();
  const city = String(request.query.city || "").trim().toLowerCase();
  const speciality = String(request.query.speciality || "").trim().toLowerCase();
  const language = String(request.query.language || "").trim().toLowerCase();
  const type = String(request.query.type || "").trim().toLowerCase();

  const providers = database.providers
    .filter((provider) => provider.status === "Verified")
    .filter((provider) => {
      const searchable = [
        provider.name,
        provider.speciality,
        provider.city,
        provider.state,
        provider.about,
        ...(provider.languages || [])
      ]
        .join(" ")
        .toLowerCase();

      return !search || searchable.includes(search);
    })
    .filter((provider) => !city || provider.city.toLowerCase().includes(city))
    .filter((provider) => !speciality || provider.speciality.toLowerCase().includes(speciality))
    .filter((provider) => !type || provider.type.toLowerCase() === type)
    .filter((provider) => !language || (provider.languages || []).some((item) => item.toLowerCase() === language));

  response.json(providers.map(providerToPublic));
});

app.get("/api/public/providers/:id", (request, response) => {
  const provider = database.providers.find(
    (item) => item.id === request.params.id && item.status === "Verified"
  );

  if (!provider) {
    return response.status(404).json({
      message: "Verified provider not found."
    });
  }

  response.json(providerToPublic(provider));
});

/* Public campaigns */

app.get("/api/public/campaigns", (request, response) => {
  const search = String(request.query.search || "").trim().toLowerCase();
  const category = String(request.query.category || "").trim().toLowerCase();
  const location = String(request.query.location || "").trim().toLowerCase();
  const nowValue = Date.now();

  const campaigns = (database.campaigns || [])
    .filter((campaign) => campaign.status === "Published")
    // Published campaigns are visible immediately; endAt controls expiry.
    .filter((campaign) => !campaign.endAt || new Date(campaign.endAt).getTime() >= nowValue)
    .filter((campaign) => {
      const searchable = [campaign.title, campaign.objective, campaign.category, campaign.description, campaign.location]
        .join(" ")
        .toLowerCase();
      return !search || searchable.includes(search);
    })
    .filter((campaign) => !category || campaign.category.toLowerCase() === category)
    .filter((campaign) => !location || campaign.location.toLowerCase().includes(location))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  response.json(campaigns.map(campaignToPublic));
});

/* Provider account */

app.get("/api/provider/me", requireAuth, requireProvider, (request, response) => {
  const provider = findProviderForUser(request.user);

  if (!provider) {
    return response.status(404).json({
      message: "Provider profile not found."
    });
  }

  response.json({
    user: publicUser(request.user),
    provider: providerToWorkspace(provider)
  });
});

app.patch("/api/provider/me", requireAuth, requireProvider, (request, response) => {
  const provider = findProviderForUser(request.user);

  if (!provider) {
    return response.status(404).json({ message: "Provider profile not found." });
  }

  const allowedFields = [
    "name",
    "speciality",
    "registrationNumber",
    "experience",
    "phone",
    "website",
    "address",
    "city",
    "state",
    "pincode",
    "consultationMode",
    "workingHours",
    "languages",
    "about",
    "allowCalls",
    "allowMessages"
  ];

  for (const field of allowedFields) {
    if (request.body[field] !== undefined) {
      provider[field] = field === "languages"
        ? parseLanguages(request.body[field])
        : request.body[field];
    }
  }

  provider.status = provider.status === "Verified" ? "Under Review" : provider.status;
  provider.updatedAt = now();
  saveDatabase();

  response.json({
    message: "Provider profile updated and submitted for review.",
    provider: providerToWorkspace(provider)
  });
});

app.post("/api/provider/me/documents", requireAuth, requireProvider, providerDocumentFields, (request, response) => {
  const provider = findProviderForUser(request.user);

  if (!provider) {
    return response.status(404).json({ message: "Provider profile not found." });
  }

  const documents = saveUploadedDocuments(request.files, provider.id);
  provider.status = provider.status === "Verified" ? "Under Review" : provider.status;
  provider.updatedAt = now();
  runDocumentScreening(provider.id).catch((error) => console.error("Document screening failed:", error.message));
  saveDatabase();

  response.status(201).json({
    message: "Documents uploaded for review.",
    documents: documents.map((document) => ({
      id: document.id,
      name: document.originalName,
      status: document.status
    }))
  });
});

/* NGO campaigns */

function findVerifiedNgoForUser(user) {
  const provider = findProviderForUser(user);
  return provider && provider.type.toLowerCase() === "ngo" && provider.status === "Verified"
    ? provider
    : null;
}

app.get("/api/ngo/campaigns", requireAuth, requireProvider, (request, response) => {
  const ngo = findVerifiedNgoForUser(request.user);
  if (!ngo) return response.status(403).json({ message: "A verified NGO profile is required." });
  response.json((database.campaigns || []).filter((campaign) => campaign.ngoId === ngo.id).map(campaignToPublic));
});

app.post("/api/ngo/campaigns", requireAuth, requireProvider, async (request, response) => {
  const ngo = findVerifiedNgoForUser(request.user);
  if (!ngo) return response.status(403).json({ message: "A verified NGO profile is required." });

  const body = request.body || {};
  const title = String(body.title || "").trim().slice(0, 220);
  const objective = String(body.objective || "").trim().slice(0, 300);
  const category = String(body.category || "").trim().slice(0, 120);
  const description = String(body.description || "").trim().slice(0, 6000);
  const location = String(body.location || "").trim().slice(0, 180);
  const startAt = String(body.startAt || "").trim();
  const endAt = String(body.endAt || "").trim();

  if (!title || !objective || !category || !description || !location || !startAt) {
    return response.status(400).json({ message: "Title, objective, category, description, location and start date are required." });
  }

  if (Number.isNaN(new Date(startAt).getTime()) || (endAt && Number.isNaN(new Date(endAt).getTime()))) {
    return response.status(400).json({ message: "Please provide valid campaign dates." });
  }

  const campaign = {
    id: createId("campaign"),
    ngoId: ngo.id,
    title,
    objective,
    category,
    description,
    location,
    startAt: new Date(startAt).toISOString(),
    endAt: endAt ? new Date(endAt).toISOString() : null,
    contactPhone: String(body.contactPhone || ngo.phone || "").trim().slice(0, 32),
    contactEmail: normalizeEmail(body.contactEmail || ngo.email),
    website: String(body.website || ngo.website || "").trim().slice(0, 255),
    supportingUrl: String(body.supportingUrl || "").trim().slice(0, 500),
    status: "Published",
    createdAt: now(),
    updatedAt: now()
  };

  database.campaigns.unshift(campaign);
  await saveDatabase();
  response.status(201).json({ message: "Campaign published successfully.", campaign: campaignToPublic(campaign) });
});

app.patch("/api/ngo/campaigns/:id", requireAuth, requireProvider, async (request, response) => {
  const ngo = findVerifiedNgoForUser(request.user);
  const campaign = (database.campaigns || []).find((item) => item.id === request.params.id && item.ngoId === ngo?.id);
  if (!ngo || !campaign) return response.status(404).json({ message: "Campaign not found." });

  const body = request.body || {};
  campaign.title = String(body.title || campaign.title).trim().slice(0, 220);
  campaign.objective = String(body.objective || campaign.objective).trim().slice(0, 300);
  campaign.category = String(body.category || campaign.category).trim().slice(0, 120);
  campaign.description = String(body.description || campaign.description).trim().slice(0, 6000);
  campaign.location = String(body.location || campaign.location).trim().slice(0, 180);
  campaign.startAt = body.startAt ? new Date(body.startAt).toISOString() : campaign.startAt;
  campaign.endAt = body.endAt ? new Date(body.endAt).toISOString() : null;
  campaign.contactPhone = String(body.contactPhone || campaign.contactPhone || "").trim().slice(0, 32);
  campaign.contactEmail = normalizeEmail(body.contactEmail || campaign.contactEmail || ngo.email);
  campaign.website = String(body.website || campaign.website || "").trim().slice(0, 255);
  campaign.supportingUrl = String(body.supportingUrl || campaign.supportingUrl || "").trim().slice(0, 500);
  campaign.updatedAt = now();

  await saveDatabase();
  response.json({ message: "Campaign updated successfully.", campaign: campaignToPublic(campaign) });
});

/* Body awareness and lifestyle assessment */

app.post("/api/health-issues", (request, response) => {
  const user = getCurrentUser(request);
  const body = request.body || {};
  const symptoms = Array.isArray(body.symptoms)
    ? body.symptoms.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : [];
  const severity = ["Mild", "Moderate", "Severe"].includes(body.severity)
    ? body.severity
    : "Mild";

  const issue = {
    id: createId("issue"),
    userId: user?.id || null,
    region: String(body.region || "").trim().slice(0, 100),
    symptoms,
    details: String(body.details || "").trim().slice(0, 4000),
    severity,
    duration: String(body.duration || "").trim().slice(0, 80),
    recommendedSpeciality: String(body.recommendedSpeciality || "").trim().slice(0, 180),
    createdAt: now()
  };

  if (!issue.region || !issue.duration) {
    return response.status(400).json({ message: "Region and duration are required." });
  }

  database.healthIssues.push(issue);
  saveDatabase();
  response.status(201).json({ message: "Body awareness entry saved.", issueId: issue.id });
});

app.post("/api/wellness-assessments", (request, response) => {
  const user = getCurrentUser(request);
  const body = request.body || {};
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 20) : [];
  const probabilities = body.probabilities && typeof body.probabilities === "object"
    ? body.probabilities
    : {};
  const dimensions = body.dimensions && typeof body.dimensions === "object"
    ? body.dimensions
    : {};

  const assessment = {
    id: createId("assessment"),
    userId: user?.id || null,
    answers,
    probabilities,
    dimensions,
    primaryPattern: String(body.primaryPattern || "balanced").slice(0, 80),
    score: Number.isFinite(Number(body.score)) ? Math.max(0, Math.min(100, Number(body.score))) : 0,
    createdAt: now()
  };

  database.wellnessAssessments.push(assessment);
  database.wellnessAssessments = database.wellnessAssessments.slice(-5000);
  saveDatabase();
  response.status(201).json({ message: "Lifestyle assessment saved.", assessmentId: assessment.id });
});

/* Patient callback requests */

app.post("/api/call-requests", requireAuth, async (request, response) => {
  if (request.user.role !== "patient") {
    return response.status(403).json({ message: "Only patient accounts can request a provider callback." });
  }

  const provider = database.providers.find(
    (item) => item.id === request.body?.providerId && item.status === "Verified" && item.allowCalls !== false && item.userId
  );

  if (!provider) return response.status(404).json({ message: "This verified provider is not currently accepting callback requests." });

  const patientPhone = String(request.body?.patientPhone || request.user.phone || "").trim().slice(0, 32);
  const message = String(request.body?.message || "").trim().slice(0, 2000);
  const preferredTime = String(request.body?.preferredTime || "").trim().slice(0, 120);

  if (!patientPhone) return response.status(400).json({ message: "A callback phone number is required." });

  const callRequest = {
    id: createId("call"),
    patientId: request.user.id,
    providerId: provider.id,
    healthIssueId: request.body?.healthIssueId || null,
    patientPhone,
    message,
    preferredTime,
    status: "requested",
    createdAt: now(),
    updatedAt: now()
  };

  database.callRequests.unshift(callRequest);
  createNotification(provider.userId, "call_request", "New callback request", "A patient has requested a phone callback.");
  await saveDatabase();

  response.status(201).json({ message: "Callback request sent.", callRequest: callRequestToView(callRequest, request.user) });
});

app.get("/api/call-requests", requireAuth, (request, response) => {
  const provider = findProviderForUser(request.user);
  const items = (database.callRequests || [])
    .filter((item) => item.patientId === request.user.id || (provider && item.providerId === provider.id))
    .map((item) => callRequestToView(item, request.user));
  response.json(items);
});

app.patch("/api/call-requests/:id", requireAuth, async (request, response) => {
  const callRequest = (database.callRequests || []).find((item) => item.id === request.params.id);
  if (!callRequest) return response.status(404).json({ message: "Callback request not found." });

  const provider = database.providers.find((item) => item.id === callRequest.providerId);
  const isProvider = provider?.userId === request.user.id;
  const requestedStatus = String(request.body?.status || "");

  if (isProvider && ["accepted", "declined", "completed"].includes(requestedStatus)) {
    callRequest.status = requestedStatus;
  } else if (!isProvider && callRequest.patientId === request.user.id && requestedStatus === "cancelled") {
    callRequest.status = requestedStatus;
  } else {
    return response.status(403).json({ message: "You cannot update this callback request." });
  }

  callRequest.updatedAt = now();
  const recipientId = isProvider ? callRequest.patientId : provider?.userId;
  createNotification(recipientId, "call_request_update", "Callback request updated", `Callback request status: ${callRequest.status}.`);
  await saveDatabase();
  response.json({ message: "Callback request updated.", callRequest: callRequestToView(callRequest, request.user) });
});

/* Private consultation and messaging */

app.post("/api/consultations", requireAuth, (request, response) => {
  if (request.user.role !== "patient") {
    return response.status(403).json({ message: "Only patient accounts can start a consultation request." });
  }

  const provider = database.providers.find(
    (item) => item.id === request.body?.providerId && item.status === "Verified"
  );

  if (!provider) {
    return response.status(404).json({ message: "Verified provider not found." });
  }

  const message = String(request.body?.message || "").trim();
  if (!message) {
    return response.status(400).json({ message: "Please write a short message for the provider." });
  }

  const consultation = {
    id: createId("consultation"),
    patientId: request.user.id,
    providerId: provider.id,
    healthIssueId: request.body?.healthIssueId || null,
    preferredChannel: ["call", "whatsapp", "message"].includes(request.body?.preferredChannel)
      ? request.body.preferredChannel
      : "message",
    message,
    status: "requested",
    createdAt: now(),
    updatedAt: now()
  };

  database.consultations.unshift(consultation);
  const providerUser = database.users.find((item) => item.id === provider.userId);
  createNotification(providerUser?.id, "consultation_request", "New patient request", "A patient has requested a private conversation.");
  saveDatabase();

  response.status(201).json({
    message: "Consultation request sent securely.",
    consultation: consultationToPrivateView(consultation, request.user)
  });
});

app.get("/api/consultations", requireAuth, (request, response) => {
  const provider = findProviderForUser(request.user);
  const items = database.consultations
    .filter((item) => item.patientId === request.user.id || (provider && item.providerId === provider.id))
    .map((item) => consultationToPrivateView(item, request.user));
  response.json(items);
});

app.patch("/api/consultations/:id", requireAuth, (request, response) => {
  const consultation = findConsultationForUser(request.params.id, request.user);
  if (!consultation) return response.status(404).json({ message: "Conversation not found." });

  const provider = database.providers.find((item) => item.id === consultation.providerId);
  const isProvider = provider && provider.userId === request.user.id;
  const requestedStatus = String(request.body?.status || "");

  if (isProvider && ["accepted", "declined", "completed"].includes(requestedStatus)) {
    consultation.status = requestedStatus;
  } else if (!isProvider && requestedStatus === "cancelled") {
    consultation.status = "cancelled";
  } else {
    return response.status(403).json({ message: "You cannot apply this conversation status." });
  }

  consultation.updatedAt = now();
  const recipientId = isProvider ? consultation.patientId : provider?.userId;
  createNotification(recipientId, "consultation_update", "Conversation updated", `Conversation status: ${consultation.status}.`);
  saveDatabase();
  response.json({ message: "Conversation status updated.", consultation: consultationToPrivateView(consultation, request.user) });
});

app.get("/api/consultations/:id/messages", requireAuth, (request, response) => {
  const consultation = findConsultationForUser(request.params.id, request.user);
  if (!consultation) return response.status(404).json({ message: "Conversation not found." });

  response.json(database.messages
    .filter((item) => item.consultationId === consultation.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(messageToPrivateView));
});

app.post("/api/consultations/:id/messages", requireAuth, (request, response) => {
  const consultation = findConsultationForUser(request.params.id, request.user);
  if (!consultation) return response.status(404).json({ message: "Conversation not found." });
  if (!["requested", "accepted"].includes(consultation.status)) {
    return response.status(409).json({ message: "This conversation is not accepting messages." });
  }

  const body = String(request.body?.body || "").trim();
  if (!body || body.length > 4000) {
    return response.status(400).json({ message: "Message must contain between 1 and 4000 characters." });
  }

  const provider = database.providers.find((item) => item.id === consultation.providerId);
  const message = {
    id: createId("message"),
    consultationId: consultation.id,
    senderId: request.user.id,
    senderRole: request.user.role,
    body,
    createdAt: now(),
    readAt: null
  };

  database.messages.push(message);
  const recipientId = request.user.id === consultation.patientId ? provider?.userId : consultation.patientId;
  createNotification(recipientId, "new_message", "New private message", "You have a new message in MediConnect.");
  consultation.updatedAt = now();
  saveDatabase();
  response.status(201).json(messageToPrivateView(message));
});

app.get("/api/notifications", requireAuth, (request, response) => {
  response.json(database.notifications.filter((item) => item.userId === request.user.id).slice(0, 50));
});

app.patch("/api/notifications/:id/read", requireAuth, (request, response) => {
  const notification = database.notifications.find((item) => item.id === request.params.id && item.userId === request.user.id);
  if (!notification) return response.status(404).json({ message: "Notification not found." });
  notification.readAt = now();
  saveDatabase();
  response.json({ message: "Notification marked as read." });
});

/* Protected administration pages */

app.get("/doctor-dashboard.html", (request, response, next) => {
  const user = getCurrentUser(request);
  if (!user) return response.redirect("/login.html?redirect=doctor-dashboard.html");
  if (user.role !== "doctor") return response.redirect("/index.html");
  next();
});

app.get("/ngo-dashboard.html", (request, response, next) => {
  const user = getCurrentUser(request);
  if (!user) return response.redirect("/login.html?redirect=ngo-dashboard.html");
  if (user.role !== "ngo") return response.redirect("/index.html");
  next();
});
app.get("/admin-panel.html", (request, response, next) => {
  const user = getCurrentUser(request);

  if (!user) {
    return response.redirect("/login.html?redirect=admin-panel.html");
  }

  if (!["admin", "super_admin"].includes(user.role)) {
    return response.redirect("/index.html");
  }

  next();
});

app.get("/provider-dashboard.html", (request, response, next) => {
  const user = getCurrentUser(request);

  if (!user) {
    return response.redirect("/login.html?redirect=provider-dashboard.html");
  }

  if (!["doctor", "hospital", "clinic", "ngo"].includes(user.role)) {
    return response.redirect("/index.html");
  }

  next();
});

/* Administration API */

app.get("/api/admin/database-summary", requireAuth, requireAdmin, (request, response) => {
  const latest = (items, dateField = "createdAt") => items
    .map((item) => item?.[dateField])
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;

  response.json([
    { table: "users", count: database.users.length, description: "Patient, provider and administrator accounts", latestAt: latest(database.users) },
    { table: "providers", count: database.providers.length, description: "Doctor, hospital, clinic and NGO profiles", latestAt: latest(database.providers) },
    { table: "campaigns", count: (database.campaigns || []).length, description: "Public health campaigns published by verified NGOs", latestAt: latest(database.campaigns || []) },
    { table: "call_requests", count: (database.callRequests || []).length, description: "Patient callback requests for verified providers", latestAt: latest(database.callRequests || []) },
    { table: "provider_documents", count: database.documents.length, description: "Uploaded certificates and verification documents", latestAt: latest(database.documents) },
    { table: "health_issues", count: database.healthIssues.length, description: "Body awareness entries submitted by visitors or patients", latestAt: latest(database.healthIssues) },
    { table: "wellness_assessments", count: database.wellnessAssessments.length, description: "Adaptive lifestyle assessment outcomes", latestAt: latest(database.wellnessAssessments) },
    { table: "consultation_requests", count: database.consultations.length, description: "Private patient-provider conversation requests", latestAt: latest(database.consultations) },
    { table: "messages", count: database.messages.length, description: "Private consultation messages", latestAt: latest(database.messages) },
    { table: "notifications", count: database.notifications.length, description: "Private account notifications", latestAt: latest(database.notifications) },
    { table: "reports", count: database.reports.length, description: "Reported provider profiles", latestAt: latest(database.reports, "submittedOn") },
    { table: "audit_logs", count: database.auditLogs.length, description: "Administrative actions and review history", latestAt: latest(database.auditLogs) }
  ]);
});

app.get("/api/admin/stats", requireAuth, requireAdmin, (request, response) => {
  const statusCount = (status) =>
    database.providers.filter((provider) => provider.status === status).length;

  response.json({
    total: database.providers.length,
    pending: database.providers.filter((provider) => ["Pending", "Submitted", "Under Review"].includes(provider.status)).length,
    verified: statusCount("Verified"),
    correctionRequired: statusCount("Correction Required"),
    suspended: statusCount("Suspended"),
    rejected: statusCount("Rejected")
  });
});

app.get("/api/admin/providers", requireAuth, requireAdmin, (request, response) => {
  const search = String(request.query.search || "").trim().toLowerCase();
  const type = String(request.query.type || "").trim().toLowerCase();
  const status = String(request.query.status || "").trim().toLowerCase();

  const providers = database.providers
    .filter((provider) => {
      const searchable = [
        provider.name,
        provider.email,
        provider.city,
        provider.state,
        provider.speciality,
        provider.registrationNumber
      ].join(" ").toLowerCase();

      return !search || searchable.includes(search);
    })
    .filter((provider) => !type || provider.type.toLowerCase() === type)
    .filter((provider) => !status || provider.status.toLowerCase() === status)
    .map(providerToAdmin);

  response.json(providers);
});

app.post("/api/admin/providers", requireAuth, requireAdmin, providerDocumentFields, async (request, response) => {
  const provider = createProviderFromRequest(request.body);
  const validationError = validateProvider(provider);

  if (validationError) {
    return response.status(400).json({ message: validationError });
  }

  database.providers.push(provider);
  saveUploadedDocuments(request.files, provider.id);
  runDocumentScreening(provider.id).catch((error) => console.error("Document screening failed:", error.message));
  createAuditLog(request.user, "Provider created", provider.id, provider.name);
  await saveDatabase();

  response.status(201).json({
    message: "Provider submitted for review.",
    provider: providerToAdmin(provider)
  });
});

app.get("/api/admin/providers/:id", requireAuth, requireAdmin, (request, response) => {
  const provider = database.providers.find(
    (item) => item.id === request.params.id
  );

  if (!provider) {
    return response.status(404).json({ message: "Provider not found." });
  }

  response.json(providerToAdmin(provider));
});

app.patch("/api/admin/providers/:id/verify", requireAuth, requireAdmin, async (request, response) => {
  const provider = database.providers.find(
    (item) => item.id === request.params.id
  );

  if (!provider) {
    return response.status(404).json({ message: "Provider not found." });
  }

  if (provider.aiVerificationStatus === "failed" && request.body?.overrideScreening !== true) {
    return response.status(409).json({
      message: "Automated screening flagged this submission. Request corrected documents or complete an authorized override review before publication."
    });
  }

  provider.status = "Verified";
  provider.rejectionReason = "";
  provider.updatedAt = now();

  database.documents
    .filter((document) => document.providerId === provider.id)
    .forEach((document) => {
      document.status = "Verified";
    });

  createAuditLog(request.user, "Provider verified", provider.id, provider.name);
  await saveDatabase();

  response.json({
    message: "Provider verified successfully.",
    provider: providerToAdmin(provider)
  });
});

app.patch("/api/admin/providers/:id/reject", requireAuth, requireAdmin, (request, response) => {
  const provider = database.providers.find(
    (item) => item.id === request.params.id
  );

  if (!provider) {
    return response.status(404).json({ message: "Provider not found." });
  }

  provider.status = "Rejected";
  provider.rejectionReason = String(request.body?.reason || "Administrative review did not approve this profile.");
  provider.updatedAt = now();
  saveDatabase();
  createAuditLog(request.user, "Provider rejected", provider.id, provider.name, provider.rejectionReason);

  response.json({
    message: "Provider rejected.",
    provider: providerToAdmin(provider)
  });
});

app.patch("/api/admin/providers/:id/correction", requireAuth, requireAdmin, (request, response) => {
  const provider = database.providers.find(
    (item) => item.id === request.params.id
  );

  if (!provider) {
    return response.status(404).json({ message: "Provider not found." });
  }

  provider.status = "Correction Required";
  provider.rejectionReason = String(request.body?.reason || "Additional information or corrected documents are required.");
  provider.updatedAt = now();
  saveDatabase();
  createAuditLog(request.user, "Correction requested", provider.id, provider.name, provider.rejectionReason);

  response.json({
    message: "Correction request recorded.",
    provider: providerToAdmin(provider)
  });
});

app.get("/api/admin/documents", requireAuth, requireAdmin, (request, response) => {
  const documents = database.documents
    .filter((document) => document.status === "Pending")
    .map((document) => {
      const provider = database.providers.find(
        (item) => item.id === document.providerId
      );

      return {
        id: document.id,
        providerName: provider?.name || "Unknown provider",
        documentType: document.documentType,
        status: document.status,
        createdAt: document.createdAt,
        securePreviewUrl: `/api/admin/documents/${document.id}/file`
      };
    });

  response.json(documents);
});

app.get("/api/admin/documents/:id/file", requireAuth, (request, response) => {
  const document = database.documents.find(
    (item) => item.id === request.params.id
  );

  if (!document) {
    return response.status(404).json({ message: "Document not found." });
  }

  const provider = database.providers.find(
    (item) => item.id === document.providerId
  );

  const isAdmin = ["admin", "super_admin"].includes(request.user.role);
  const isOwner = provider && provider.userId === request.user.id;

  if (!isAdmin && !isOwner) {
    return response.status(403).json({ message: "Document access denied." });
  }

  const filePath = path.join(DOCUMENT_DIR, document.storedName);

  if (!fs.existsSync(filePath)) {
    return response.status(404).json({ message: "Stored document not found." });
  }

  response.sendFile(filePath);
});

app.get("/api/admin/reports", requireAuth, requireAdmin, (request, response) => {
  response.json(database.reports);
});

app.get("/api/admin/audit-logs", requireAuth, requireAdmin, (request, response) => {
  response.json(database.auditLogs.slice(0, 100));
});

/* Private storage must never be served as public static content. */

app.use("/data", (request, response) => {
  response.status(404).send("Not found");
});

/* Static files */

app.use(express.static(ROOT, {
  index: "index.html",
  dotfiles: "deny"
}));

app.use((error, request, response, next) => {
  if (error.message?.includes("document") || error.message?.includes("Request is too large")) {
    return response.status(400).json({
      message: error.message
    });
  }

  console.error("Unhandled server error:", error);
  response.status(500).json({
    message: "An unexpected server error occurred."
  });
});

async function startServer() {
  if (mysqlStore) {
    try {
      database = await mysqlStore.load();
      console.log("Hosted MySQL persistence enabled.");
    } catch (error) {
      console.error("Hosted MySQL connection failed:", error.message);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log("Local JSON persistence enabled. Add MYSQL_URL or MYSQL_HOST/MYSQL_USER to enable hosted MySQL.");
  }

  await bootstrapAdmin();

  app.listen(PORT, () => {
    console.log(`MediConnect is running at http://localhost:${PORT}`);
  });
}

startServer();

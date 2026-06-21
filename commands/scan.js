const fs   = require("fs");
const path = require("path");

// ── low-level helpers ─────────────────────────────────────────────────────────

function readFile(f)        { try { return fs.readFileSync(f, "utf8"); } catch (_) { return ""; } }
function extractPackage(s)  { const m = /^package\s+([\w.]+)\s*;/m.exec(s); return m ? m[1] : null; }
function extractClassName(s){ const m = /(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/.exec(s); return m ? m[1] : null; }
function extractBasePath(s) { const m = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/.exec(s); return m ? m[1] : ""; }

// { varName → TypeName } for all injected collaborators
function extractInjectedDeps(src) {
    const deps = {};
    const re = /(?:@Autowired[^\n]*\n\s*)?private\s+(?:final\s+)?([\w<>]+)\s+(\w+)\s*;/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (/Service|Repository|Client|Gateway|Dao|Component|Manager|Mapper|Converter|Feign/.test(m[1]))
            deps[m[2]] = m[1];
    }
    return deps;
}

// brace-match starting at or after fromIdx — returns the content between { }
function extractMethodBody(src, fromIdx) {
    let depth = 0, start = -1;
    for (let i = fromIdx; i < src.length; i++) {
        if (src[i] === "{") { if (!depth) start = i + 1; depth++; }
        else if (src[i] === "}") { depth--; if (!depth && start !== -1) return src.slice(start, i).trim(); }
    }
    return "";
}

// ── SERVICE INDEX — key cross-reference capability ────────────────────────────
//
// Reads every service/impl file and builds:
//   { "ServiceInterfaceName" → { className, methods: { "methodName" → { body, deps, returnType } } } }
// This lets controller-level tracing "open" the service and see what really happens.

function buildServiceIndex(serviceFiles) {
    const index = {};

    for (const f of serviceFiles) {
        const src       = readFile(f);
        const className = extractClassName(src);
        if (!className) continue;

        const deps    = extractInjectedDeps(src);
        const methods = {};

        // capture every public method signature and brace-match its body
        const re = /public\s+(?:(?:static|final|synchronized|abstract)\s+)*(?!class\b)([\w<>[\],\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws[^{]+)?(?=\s*\{)/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            const name = m[2];
            if (/^(class|interface|enum|if|while|for|switch|try|new)$/.test(name)) continue;
            const open = src.indexOf("{", m.index + m[0].length);
            if (open === -1) continue;
            methods[name] = { body: extractMethodBody(src, open), deps, returnType: m[1].trim(), params: m[3].trim() };
        }

        index[className] = { className, methods };

        // also register under every implemented interface so "OrderService" finds "OrderServiceImpl"
        const implM = /implements\s+([\w\s,<>]+?)(?:\{|extends\s)/.exec(src);
        if (implM) {
            for (const iface of implM[1].split(",").map(s => s.replace(/<.*>/, "").trim()).filter(Boolean))
                index[iface] = { className, methods };
        }
    }

    return index;
}

// ── PLAIN-ENGLISH INFERENCE ───────────────────────────────────────────────────

// What does a repository / downstream-service call actually do?
function inferCallDescription(depType, methodName) {
    const mn     = methodName.toLowerCase();
    const dt     = depType.toLowerCase();
    const entity = depType.replace(/Repository|Service(Impl)?|Client|Dao|Manager|Impl/g, "").trim() || "record";

    if (/repository|dao/.test(dt)) {
        if (mn === "save" || mn === "saveall" || mn === "saveandflush")
            return `persists the \`${entity}\` to the database (INSERT or UPDATE)`;
        if (mn === "findbyid" || mn === "getbyid" || mn === "getone")
            return `looks up \`${entity}\` by primary key — wraps result in Optional`;
        if (mn === "findall" && !mn.includes("by"))
            return `fetches every \`${entity}\` row from the database`;
        if (mn.startsWith("findby")) {
            const field = mn.replace("findby", "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
            return `queries the database: SELECT … WHERE ${field || "field"} = ?`;
        }
        if (mn.startsWith("existsby")) {
            const field = mn.replace("existsby", "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
            return `returns true/false: does a \`${entity}\` row exist where ${field || "field"} matches?`;
        }
        if (mn === "deletebyid" || mn === "delete" || mn.startsWith("deleteby"))
            return `removes the \`${entity}\` row from the database (DELETE)`;
        if (mn === "count" || mn.startsWith("countby"))
            return `counts matching \`${entity}\` rows (SELECT COUNT)`;
        return `executes a database operation on \`${entity}\``;
    }

    if (/service|client|gateway|feign/.test(dt)) {
        if (/send|notify|publish|emit/.test(mn)) return `sends a notification or publishes an event`;
        if (/create|add|register|save/.test(mn))  return `creates a record via \`${depType}\``;
        if (/get|find|fetch|load|read/.test(mn))  return `reads data from \`${depType}\``;
        if (/update|modify|patch/.test(mn))        return `updates a record via \`${depType}\``;
        if (/delete|remove|cancel/.test(mn))       return `removes a record via \`${depType}\``;
        if (/validate|verify|check/.test(mn))      return `validates data with \`${depType}\``;
        if (/process|execute|run|submit/.test(mn)) return `delegates processing to \`${depType}\``;
        return `calls \`${depType}.${methodName}()\``;
    }

    if (/mapper|converter|assembler|transformer/.test(dt)) {
        const target = methodName.replace(/^(to|from|map|convert|transform|assemble)/i, "").trim();
        return `transforms data → produces \`${target || "converted object"}\``;
    }

    return `calls \`${depType}.${methodName}()\``;
}

// Open the service method body and extract meaningful steps
function analyzeServiceBody(body, deps) {
    if (!body) return [];
    const steps = [];
    const seen  = new Set();
    function add(s) { if (!seen.has(s)) { seen.add(s); steps.push(s); } }

    // ── validation patterns ──────────────────────────────────────────────────
    if (/Objects\.requireNonNull\s*\(/.test(body))
        add("Validates that required inputs are non-null (`Objects.requireNonNull`)");
    if (/\.orElseThrow\s*\(/.test(body))
        add("Unwraps the Optional result — throws a not-found exception if the entity is absent");
    if (/if\s*\([^{]*==\s*null[^{]*\)\s*[\n\s]*(?:throw|return)/.test(body))
        add("Null-guards: throws an exception or returns early if the entity is not found");

    // ── status mutation ───────────────────────────────────────────────────────
    const setM = /\.set(?:[A-Z]\w+)?\s*\(\s*(?:[A-Z_]{3,}|["']\w+["'])\s*\)/.exec(body);
    if (setM) {
        const val = /\(\s*([A-Z_]{3,}|["']\w+["'])\s*\)/.exec(setM[0]);
        add(`Mutates entity state (sets a field to ${val ? val[1] : "a new value"})`);
    }

    // ── mapper / converter calls ─────────────────────────────────────────────
    const mapperRe = /\b(\w+(?:Mapper|Converter|Assembler|Builder))\.(to\w+|from\w+|map\w*|convert\w*|assemble\w*)\s*\(/g;
    let mm;
    const seenMappers = new Set();
    while ((mm = mapperRe.exec(body)) !== null) {
        const key    = `${mm[1]}.${mm[2]}`;
        if (seenMappers.has(key)) continue;
        seenMappers.add(key);
        const target = mm[2].replace(/^(to|from|map|convert|assemble)/i, "").trim() || "object";
        add(`Converts data with \`${mm[1]}.${mm[2]}()\` → produces \`${target}\``);
    }

    // ── downstream dependency calls (repos, services, clients) ───────────────
    const callRe    = /\b(\w+)\.([\w]+)\s*\(/g;
    const seenCalls = new Set();
    let m;
    while ((m = callRe.exec(body)) !== null) {
        const varName = m[1];
        const method  = m[2];
        const key     = `${varName}.${method}`;
        if (!deps[varName] || seenCalls.has(key)) continue;
        if (/^(log|logger|LOGGER|this|super|System|Objects|Collections|Arrays|Math|Optional|String)$/.test(varName)) continue;
        seenCalls.add(key);
        add(`\`${deps[varName]}.${method}()\` — ${inferCallDescription(deps[varName], method)}`);
    }

    // ── explicit exception throws ─────────────────────────────────────────────
    const throwRe = /throw\s+new\s+([\w]+(?:Exception|Error|NotFound|Unauthorized|Forbidden|Conflict|BadRequest))\s*\(/g;
    let tm;
    while ((tm = throwRe.exec(body)) !== null) {
        const exc = tm[1];
        if (!seen.has("throw-" + exc)) {
            seen.add("throw-" + exc);
            add(`Throws \`${exc}\` if a business rule or precondition is violated`);
        }
    }

    return steps;
}

// ── FLOW TRACER — controller body → service layer → repo layer ────────────────

function traceEndpointFlow(controllerBody, controllerDeps, serviceIndex, responseStatus, returnType) {
    const steps = [];

    // @Valid on params
    if (/@Valid\b|@Validated\b/.test(controllerBody))
        steps.push({ type: "info", text: "Spring auto-validates the request body via `@Valid` Bean Validation annotations" });

    const callRe    = /\b(\w+)\.([\w]+)\s*\(/g;
    const seenCalls = new Set();
    let m;

    while ((m = callRe.exec(controllerBody)) !== null) {
        const varName    = m[1];
        const methodName = m[2];
        const callKey    = `${varName}.${methodName}`;
        if (!controllerDeps[varName] || seenCalls.has(callKey)) continue;
        if (/^(log|logger|LOGGER|this|super|Objects|System)$/.test(varName)) continue;
        seenCalls.add(callKey);

        const serviceType = controllerDeps[varName];
        const svcEntry    = serviceIndex[serviceType];
        let   subSteps    = [];
        let   returnInfo  = "";

        if (svcEntry && svcEntry.methods[methodName]) {
            const method = svcEntry.methods[methodName];
            subSteps   = analyzeServiceBody(method.body, method.deps);
            returnInfo = method.returnType;
        }

        steps.push({ type: "serviceCall", service: serviceType, method: methodName, returnInfo, subSteps });
    }

    // mapper called directly in the controller (e.g. response mapping after service returns)
    const mapperRe = /\b(\w+(?:Mapper|Converter|Builder))\.(to\w+|from\w+|map\w*|convert\w*)\s*\(/g;
    while ((m = mapperRe.exec(controllerBody)) !== null) {
        const target = m[2].replace(/^(to|from|map|convert)/i, "").trim() || "DTO";
        steps.push({ type: "info", text: `Controller converts the result using \`${m[1]}.${m[2]}()\` → \`${target}\`` });
    }

    steps.push({ type: "response", status: responseStatus, returnType });
    return steps;
}

// Render traced flow as numbered markdown with indented sub-bullets
function renderFlow(steps) {
    let md = `**End-to-End Flow**:\n`;
    let n  = 1;
    for (const step of steps) {
        if (step.type === "info") {
            md += `${n++}. ${step.text}\n`;
        } else if (step.type === "serviceCall") {
            const verb = operationVerb(step.method);
            md += `${n++}. Calls **\`${step.service}.${step.method}()\`** — _${verb}_\n`;
            if (step.subSteps.length) {
                for (const sub of step.subSteps) md += `   - ${sub}\n`;
            } else {
                md += `   - _(ServiceImpl not found under \`src/\` — ensure the file ends with \`ServiceImpl.java\`)_\n`;
            }
        } else if (step.type === "response") {
            md += `${n++}. Returns **\`${step.status}\`**`;
            if (step.returnType && step.returnType !== "void" && step.returnType !== "Void")
                md += ` carrying \`${step.returnType}\``;
            md += `\n`;
        }
    }
    return md;
}

function operationVerb(methodName) {
    const mn = methodName.toLowerCase();
    if (/create|add|register|save|new/.test(mn))  return "creates and persists a new entity";
    if (/all|list|findall|getall/.test(mn))       return "retrieves all records";
    if (/get|find|fetch|load|retrieve/.test(mn))  return "retrieves the entity by the given identifier";
    if (/update|edit|modify|patch/.test(mn))      return "applies the requested changes to the entity";
    if (/delete|remove|cancel/.test(mn))          return "removes / cancels the entity";
    if (/send|notify|publish|emit/.test(mn))      return "sends a notification or publishes an event";
    if (/validate|verify|check/.test(mn))         return "validates / verifies the data";
    if (/process|execute|run|submit/.test(mn))    return "processes the business logic";
    if (/health|status/.test(mn))                 return "checks health or operational status";
    if (/calculate|compute/.test(mn))             return "calculates the result";
    return "handles the business logic";
}

// ── RESPONSE STATUS ───────────────────────────────────────────────────────────

function detectResponseStatus(body, returnType) {
    if (/ResponseEntity\.created\s*\(/.test(body))    return "201 Created";
    if (/ResponseEntity\.accepted\s*\(/.test(body))   return "202 Accepted";
    if (/ResponseEntity\.noContent\s*\(/.test(body))  return "204 No Content";
    if (/ResponseEntity\.badRequest\s*\(/.test(body)) return "400 Bad Request";
    if (/ResponseEntity\.notFound\s*\(/.test(body))   return "404 Not Found";
    if (/ResponseEntity\.ok\s*\(/.test(body))         return "200 OK";
    const sm = /ResponseEntity\.status\s*\(\s*(\d+)/.exec(body);
    if (sm) return `HTTP ${sm[1]}`;
    if (returnType === "void" || returnType === "Void") return "204 No Content";
    return "200 OK";
}

// ── ENTITY & REPOSITORY ANALYSIS ─────────────────────────────────────────────

function extractEntityFields(src) {
    const fields = [];
    const re1 = /((?:@(?:Id|Column|GeneratedValue|ManyToOne|OneToMany|OneToOne|ManyToMany|Enumerated|Lob|CreatedDate|LastModifiedDate|JoinColumn)[^\n]*\n\s*)+)(?:private|protected|public)\s+([\w<>[\],\s]+?)\s+(\w+)\s*;/g;
    let m;
    while ((m = re1.exec(src)) !== null)
        fields.push({ type: m[2].trim(), name: m[3], annotations: (m[1].match(/@\w+/g) || []).join(", ") });
    if (!fields.length) {
        const re2 = /private\s+([\w<>[\],\s]+?)\s+(\w+)\s*;/g;
        while ((m = re2.exec(src)) !== null) fields.push({ type: m[1].trim(), name: m[2], annotations: "" });
    }
    return [...new Map(fields.map(f => [f.name, f])).values()].slice(0, 15);
}

function inferFieldMeaning(name, type, annotations) {
    const n = name.toLowerCase();
    if (annotations.includes("@Id"))               return "Primary key — unique database row identifier";
    if (n === "id")                                return "Unique identifier";
    if (/createdat|createdon|createddate/.test(n)) return "Timestamp auto-set when the record was first created";
    if (/updatedat|modifiedat|lastupdated/.test(n))return "Timestamp auto-updated on every change";
    if (/deletedat|softdelete/.test(n))            return "Soft-delete marker — null = active record";
    if (n === "status")                            return "Lifecycle state (e.g. PENDING, ACTIVE, CLOSED)";
    if (n === "name" || n.endsWith("name"))        return "Human-readable display name";
    if (n === "email")                             return "Email address";
    if (/password|passwordhash/.test(n))           return "Hashed password (never stored in plain-text)";
    if (n.includes("token"))                       return "Auth or reset token";
    if (/amount|price|cost|fee/.test(n))           return "Monetary value";
    if (/count|quantity/.test(n))                  return "Numeric count or quantity";
    if (n.endsWith("id") && n !== "id")            return `Foreign key → \`${name.slice(0, -2)}\` table`;
    if (annotations.includes("@ManyToOne"))        return "Many-to-one — this record belongs to a parent";
    if (annotations.includes("@OneToMany"))        return "One-to-many — this record is the parent of a collection";
    if (annotations.includes("@OneToOne"))         return "One-to-one relationship";
    if (annotations.includes("@ManyToMany"))       return "Many-to-many relationship";
    if (/^(List|Set|Collection)</.test(type))      return `Collection of \`${type.replace(/^(?:List|Set|Collection)<(.+)>$/, "$1")}\` records`;
    return "";
}

function extractRepositoryDetails(src) {
    const ext = /extends\s+(JpaRepository|CrudRepository|PagingAndSortingRepository|MongoRepository|ReactiveCrudRepository)\s*<([^>]+)>/.exec(src);
    const methods = [];
    const re = /(find\w+|count\w+|exists\w+|delete\w+|search\w*)\s*\([^)]*\)\s*;/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const name  = m[1];
        const field = name.replace(/^(findBy|findAllBy|findFirst\d*By|countBy|existsBy|deleteBy|search)/i, "")
                         .replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
        methods.push({ name, field: field || "criteria" });
    }
    return {
        extendsType:   ext ? `${ext[1]}<${ext[2]}>` : null,
        entityType:    ext ? ext[2].split(",")[0].trim() : null,
        customMethods: [...new Map(methods.map(x => [x.name, x])).values()].slice(0, 10)
    };
}

// ── DIRECTORY WALKER ──────────────────────────────────────────────────────────

function scanDirectory(dir, buckets) {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) { scanDirectory(full, buckets); continue; }
        if      (file.endsWith("Controller.java"))  buckets.controllers.push(full);
        else if (file.endsWith("ServiceImpl.java")) buckets.serviceImpls.push(full);
        else if (file.endsWith("Service.java"))     buckets.services.push(full);
        else if (file.endsWith("Repository.java"))  buckets.repositories.push(full);
        else if (file.endsWith("Entity.java") || file.endsWith("Model.java")) buckets.entities.push(full);
    }
}

function domainName(className) {
    return className.replace(/Controller$|Service(Impl)?$|Repository$|Entity$|Model$/, "").trim() || className;
}

// ── MARKDOWN BUILDERS ─────────────────────────────────────────────────────────

function buildRepositoryIndex(buckets) {
    const rel = f => f.replace(/\\/g, "/");
    let md = "# Repository Index\n\n";
    md += "## Controllers\n";
    buckets.controllers.forEach(f => (md += `- [${path.basename(f)}](${rel(f)})\n`));
    md += "\n## Services\n";
    [...buckets.services, ...buckets.serviceImpls].forEach(f => (md += `- [${path.basename(f)}](${rel(f)})\n`));
    md += "\n## Repositories\n";
    buckets.repositories.forEach(f => (md += `- [${path.basename(f)}](${rel(f)})\n`));
    md += "\n## Entities / Models\n";
    buckets.entities.forEach(f => (md += `- [${path.basename(f)}](${rel(f)})\n`));
    return md;
}

function buildArchitecture(buckets) {
    let packageName = "unknown";
    for (const f of [...buckets.controllers, ...buckets.services, ...buckets.repositories, ...buckets.entities]) {
        const pkg = extractPackage(readFile(f));
        if (pkg) { packageName = pkg.split(".").slice(0, 3).join("."); break; }
    }

    const allServices = [...buckets.services, ...buckets.serviceImpls];

    // Build service index FIRST — needed for cross-layer flow tracing
    const serviceIndex = buildServiceIndex(allServices);

    let md = `# Project Architecture\n\n`;

    // Overview counts
    md += `## Overview\n\n`;
    md += `| | |\n|---|---|\n`;
    md += `| **Base package** | \`${packageName}\` |\n`;
    md += `| **Controllers** | ${buckets.controllers.length} |\n`;
    md += `| **Services** | ${allServices.length} |\n`;
    md += `| **Repositories** | ${buckets.repositories.length} |\n`;
    md += `| **Entities** | ${buckets.entities.length} |\n\n`;

    // Parse all controller endpoints
    const allEndpoints   = [];
    const controllerData = [];

    for (const f of buckets.controllers) {
        const src       = readFile(f);
        const className = extractClassName(src) || path.basename(f, ".java");
        const basePath  = extractBasePath(src);
        const deps      = extractInjectedDeps(src);
        const endpoints = [];

        const mappings = [
            ["GetMapping","GET"], ["PostMapping","POST"], ["PutMapping","PUT"],
            ["DeleteMapping","DELETE"], ["PatchMapping","PATCH"]
        ];

        for (const [ann, verb] of mappings) {
            const annRe = new RegExp(`@${ann}\\s*(?:\\(\\s*(?:value\\s*=\\s*)?["']([^"']+)["'][^)]*\\))?`, "g");
            let annM;
            while ((annM = annRe.exec(src)) !== null) {
                const epPath = annM[1] || "/";
                const rest   = src.slice(annM.index + annM[0].length);

                const sigRe = /(?:(?:@\w+[^\n]*\n)\s*)*public\s+([\w<>[\], ]+?)\s+(\w+)\s*\(([^)]*)\)/;
                const sigM  = sigRe.exec(rest);
                if (!sigM) continue;

                const returnType     = sigM[1].trim();
                const methodName     = sigM[2];
                const paramStr       = sigM[3].trim();
                const bodyStart      = annM.index + annM[0].length + sigM.index + sigM[0].length;
                const body           = extractMethodBody(src, bodyStart);
                const responseStatus = detectResponseStatus(body, returnType);

                // Typed inputs with role labels
                const inputs  = [];
                const paramRe = /@(RequestBody|PathVariable|RequestParam)\s*(?:\([^)]*\))?\s*([\w<>[\],\s]+?)\s+(\w+)/g;
                let pM;
                while ((pM = paramRe.exec(paramStr)) !== null)
                    inputs.push({ kind: pM[1], type: pM[2].trim(), name: pM[3] });

                // Security annotation context
                const secSnip = src.slice(Math.max(0, annM.index - 300), annM.index);
                let security  = null;
                if (/@PreAuthorize\s*\(/.test(secSnip)) {
                    const sm = /@PreAuthorize\s*\(\s*["']([^"']+)["']/.exec(secSnip);
                    security = sm ? `\`${sm[1]}\`` : "Required";
                } else if (/@Secured\s*\(|@RolesAllowed\s*\(/.test(secSnip)) {
                    security = "Role-based (@Secured / @RolesAllowed)";
                }

                // Full traced flow (cross-references serviceIndex)
                const flow = traceEndpointFlow(body, deps, serviceIndex, responseStatus, returnType);

                // Business purpose (plain English)
                const mn  = methodName.toLowerCase();
                const ent = domainName(className).toLowerCase();
                const fp  = (basePath + epPath).replace("//", "/");
                let purpose;
                if (/health/.test(mn) || /health/.test(fp))             purpose = "Health check — verifies this service is running";
                else if (/login|signin/.test(mn))                       purpose = "Authenticates the user and issues a session token";
                else if (/logout|signout/.test(mn))                     purpose = "Terminates the authenticated session";
                else if (/register|signup/.test(mn))                    purpose = "Registers a new user account";
                else if (verb === "GET" && /all|list|findall/.test(mn)) purpose = `Returns all ${ent} records`;
                else if (verb === "GET" && /\{id\}/.test(fp))           purpose = `Looks up a single ${ent} by ID`;
                else if (verb === "GET")                                purpose = `Returns ${ent} data`;
                else if (verb === "POST")                               purpose = `Creates a new ${ent}`;
                else if (verb === "PUT")                                purpose = `Fully replaces an existing ${ent}`;
                else if (verb === "PATCH")                              purpose = `Partially updates an existing ${ent}`;
                else if (verb === "DELETE")                             purpose = `Permanently removes the ${ent}`;
                else                                                    purpose = operationVerb(methodName);

                endpoints.push({ verb, path: epPath, fullPath: fp, methodName, returnType, responseStatus, inputs, flow, security, purpose });
                allEndpoints.push({ method: verb, path: fp, controller: className, purpose });
            }
        }

        controllerData.push({ f, className, basePath, deps, endpoints });
    }

    // API quick-reference table
    if (allEndpoints.length) {
        md += `## API Endpoints — Quick Reference\n\n`;
        md += `| Method | Path | What it does |\n|--------|------|--------------|\n`;
        for (const ep of allEndpoints)
            md += `| \`${ep.method}\` | \`${ep.path}\` | ${ep.purpose} |\n`;
        md += `\n`;
    }

    // ── CONTROLLERS with full traced flow ─────────────────────────────────────
    if (controllerData.length) {
        md += `---\n\n## Controllers\n\n`;
        for (const { className, basePath, deps, endpoints } of controllerData) {
            const domain   = domainName(className);
            const depNames = Object.values(deps).join(", ");

            md += `### ${className}\n\n`;
            md += `> Handles all HTTP requests for the **${domain}** domain.`;
            if (basePath)  md += ` All endpoints share the base path \`${basePath}\`.`;
            if (depNames)  md += ` Business logic is delegated to: **${depNames}**.`;
            md += `\n\n`;

            if (!endpoints.length) { md += `> No HTTP mapping annotations found.\n\n`; continue; }

            for (const ep of endpoints) {
                md += `---\n\n`;
                md += `#### \`${ep.verb} ${ep.fullPath}\`\n\n`;
                md += `| | |\n|---|---|\n`;
                md += `| **Java method** | \`${ep.methodName}()\` |\n`;
                md += `| **Purpose** | ${ep.purpose} |\n`;
                if (ep.security) md += `| **Security** | ${ep.security} |\n`;
                md += `\n`;

                if (ep.inputs.length) {
                    md += `**Request inputs**:\n`;
                    const labels = {
                        RequestBody:  "Request body (JSON payload)",
                        PathVariable: "Path variable (URL segment, e.g. `/orders/{id}`)",
                        RequestParam: "Query parameter (e.g. `?page=0`)"
                    };
                    for (const inp of ep.inputs)
                        md += `- \`${inp.type} ${inp.name}\` — ${labels[inp.kind] || inp.kind}\n`;
                } else {
                    md += `**Request inputs**: none`;
                }
                md += `\n\n`;

                md += `**Response**: \`${ep.responseStatus}\``;
                if (ep.returnType && ep.returnType !== "void" && ep.returnType !== "Void")
                    md += ` → \`${ep.returnType}\``;
                md += `\n\n`;

                md += renderFlow(ep.flow);
                md += `\n`;
            }
        }
    }

    // ── SERVICES ──────────────────────────────────────────────────────────────
    if (allServices.length) {
        md += `---\n\n## Services\n\n`;
        for (const f of allServices) {
            const src       = readFile(f);
            const className = extractClassName(src) || path.basename(f, ".java");
            const domain    = domainName(className);
            const deps      = extractInjectedDeps(src);
            const svcEntry  = serviceIndex[className];
            const methods   = svcEntry ? Object.entries(svcEntry.methods) : [];

            md += `### ${className}\n\n`;
            md += `> Owns all business logic for the **${domain}** domain.`;
            const down = Object.values(deps);
            if (down.length) md += ` Depends on: **${down.join(", ")}**.`;
            md += `\n\n`;

            if (methods.length) {
                md += `**Operations**:\n\n`;
                md += `| Method | Signature | What it does |\n|--------|-----------|-------------|\n`;
                for (const [name, meta] of methods.slice(0, 15)) {
                    const shortSig = `${meta.returnType} ${name}(${meta.params.length > 45 ? meta.params.slice(0, 45) + "…" : meta.params})`;
                    md += `| \`${name}\` | \`${shortSig}\` | ${operationVerb(name)} |\n`;
                }
                md += `\n`;
            }
        }
    }

    // ── REPOSITORIES ──────────────────────────────────────────────────────────
    if (buckets.repositories.length) {
        md += `---\n\n## Repositories\n\n`;
        for (const f of buckets.repositories) {
            const src  = readFile(f);
            const name = extractClassName(src) || path.basename(f, ".java");
            const { extendsType, entityType, customMethods } = extractRepositoryDetails(src);

            md += `### ${name}\n\n`;
            md += `> Manages all database access for \`${entityType || domainName(name)}\` records.\n\n`;
            if (extendsType) {
                md += `Extends \`${extendsType}\` — inherits out-of-the-box: `;
                md += `\`findById\`, \`findAll\`, \`save\`, \`deleteById\`, \`existsById\`, \`count\`.\n\n`;
            }
            if (customMethods.length) {
                md += `**Custom queries (beyond inherited CRUD)**:\n`;
                for (const cm of customMethods)
                    md += `- \`${cm.name}()\` — Spring Data auto-generates \`SELECT … WHERE ${cm.field} = ?\` from the method name\n`;
                md += `\n`;
            } else {
                md += `No custom query methods — uses only the inherited CRUD operations.\n\n`;
            }
        }
    }

    // ── DATA MODEL ────────────────────────────────────────────────────────────
    if (buckets.entities.length) {
        md += `---\n\n## Data Model\n\n`;
        for (const f of buckets.entities) {
            const src    = readFile(f);
            const name   = extractClassName(src) || path.basename(f, ".java");
            const fields = extractEntityFields(src);
            const tableM = /@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/.exec(src);

            md += `### ${name}\n\n`;
            md += `> Represents a **${domainName(name)}** record stored in the database`;
            if (tableM) md += ` (table: \`${tableM[1]}\`)`;
            md += `.\n\n`;

            if (fields.length) {
                md += `| Field | Type | What it stores |\n|-------|------|----------------|\n`;
                for (const fld of fields) {
                    const meaning = inferFieldMeaning(fld.name, fld.type, fld.annotations);
                    const anns    = fld.annotations ? ` _(${fld.annotations})_` : "";
                    md += `| \`${fld.name}\`${anns} | \`${fld.type}\` | ${meaning || "—"} |\n`;
                }
                md += `\n`;
            }
        }
    }

    // ── LAYER DIAGRAM ─────────────────────────────────────────────────────────
    if (allEndpoints.length) {
        md += `---\n\n## How the Layers Connect\n\n`;
        md += `\`\`\`\n`;
        md += `HTTP Client  (browser / mobile app / another service)\n`;
        md += `    │\n    │  HTTP request\n    ▼\n`;
        for (const { className, basePath } of controllerData)
            md += `${className}  ←  @RestController  (routes requests${basePath ? `, base: ${basePath}` : ""}, delegates logic)\n`;
        md += `    │\n    │  method call\n    ▼\n`;
        for (const f of allServices) {
            const cn = extractClassName(readFile(f)) || path.basename(f, ".java");
            md += `${cn}  ←  @Service  (applies business rules, orchestrates data access)\n`;
        }
        if (buckets.repositories.length) {
            md += `    │\n    │  JPA / Spring Data\n    ▼\n`;
            for (const f of buckets.repositories) {
                const cn = extractClassName(readFile(f)) || path.basename(f, ".java");
                md += `${cn}  ←  @Repository  (SQL database reads and writes)\n`;
            }
        }
        md += `\`\`\`\n`;
    }

    const total = buckets.controllers.length + allServices.length + buckets.repositories.length + buckets.entities.length;
    if (!total) md += `> No Spring Boot components found under \`src/\`. Run this command from the project root.\n`;

    return md;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

module.exports = function scan() {
    const buckets = { controllers: [], services: [], serviceImpls: [], repositories: [], entities: [] };
    console.log("Scanning repository...");
    scanDirectory("src", buckets);
    if (!fs.existsSync("docs")) fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/repository-index.md", buildRepositoryIndex(buckets));
    console.log("docs/repository-index.md updated");
    fs.writeFileSync("docs/architecture.md", buildArchitecture(buckets));
    console.log("docs/architecture.md updated");
};

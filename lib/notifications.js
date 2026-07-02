const hrms = require("./hrms-repo");

const store = require("./data-store");

const { useSupabase } = require("./backend");

const notifyStore = require("./notify-store");



async function collectNotifications(username, role) {

  const items = [];

  const now = new Date();



  if (useSupabase()) {

    try {

      const persisted = await notifyStore.readNotifications(username, { limit: 30 });

      for (const n of persisted) {

        items.push({

          id: n.id,

          type: n.type,

          title: n.title,

          body: n.body,

          createdAt: n.createdAt,

          entityType: n.entityType,

          entityId: n.entityId,

          readAt: n.readAt,

          persisted: true,

        });

      }



      const leave = await hrms.readLeaveRequests({ status: "pending" });

      const approvers = ["mark", "raymond", "phoebe"];

      if (approvers.includes(String(username || "").toLowerCase())) {

        for (const l of leave.slice(0, 10)) {

          items.push({

            id: `leave-${l.id}`,

            type: "leave",

            title: "Leave request pending approval",

            body: `${l.employeeId}: ${l.startDate} – ${l.endDate}`,

            createdAt: l.createdAt,

          });

        }

      }



      const docs = store.getEmployeeDocuments();

      if (Array.isArray(docs)) {

        const soon = docs.filter((d) => {

          if (d.noExpiry || !d.expiry) return false;

          const exp = new Date(d.expiry);

          const days = (exp - now) / (86400000);

          return days >= 0 && days <= 30;

        });

        for (const d of soon.slice(0, 8)) {

          items.push({

            id: `doc-${d.employeeId}-${d.fileName}`,

            type: "document",

            title: "Document expiring soon",

            body: `${d.employeeId}: ${d.docType} expires ${d.expiry}`,

          });

        }

      }

    } catch (err) {

      items.push({

        id: "sync-warn",

        type: "system",

        title: "Notification check issue",

        body: err.message,

      });

    }

  }



  const seen = new Set();

  const deduped = [];

  for (const item of items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))) {

    const key = item.id || `${item.type}-${item.body}`;

    if (seen.has(key)) continue;

    seen.add(key);

    deduped.push(item);

  }

  return deduped;

}



module.exports = { collectNotifications };



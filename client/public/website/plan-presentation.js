(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SaleMaXPlans = api;
})(typeof window === "undefined" ? this : window, function () {
  "use strict";
  // Only the shared category capabilities belong in the public core comparison.
  const features = [
    {
      capabilities: ["crm.contacts"],
      en: "Customer & contact management",
      ar: "إدارة العملاء وجهات الاتصال",
    },
    {
      capabilities: ["crm.leads"],
      en: "Sales pipeline & lead follow-ups",
      ar: "مسار المبيعات ومتابعة العملاء المحتملين",
    },
    {
      capabilities: ["messaging.inbox"],
      en: "Unified team inbox",
      ar: "صندوق وارد موحد للفريق",
    },
    {
      capabilities: ["campaigns.send", "campaigns.dashboard"],
      en: "Campaigns & campaign dashboard",
      ar: "الحملات ولوحة متابعة الحملات",
    },
    {
      capabilities: ["messaging.templates"],
      en: "Message templates",
      ar: "قوالب الرسائل",
    },
    {
      capabilities: ["automation.flows", "automation.chatbot"],
      en: "Workflow automation & chatbots",
      ar: "أتمتة سير العمل وروبوتات المحادثة",
    },
    {
      capabilities: ["team.tasks"],
      en: "Team tasks & follow-up coordination",
      ar: "مهام الفريق وتنسيق المتابعات",
    },
    {
      capabilities: ["team.members"],
      en: "Team access & role-based permissions",
      ar: "وصول الفريق وصلاحيات حسب الدور",
    },
    {
      capabilities: ["reports.read"],
      en: "Activity reports & business visibility",
      ar: "تقارير النشاط ورؤية الأعمال",
    },
  ];
  function select(plans) {
    return [30, 365]
      .map((days) =>
        plans.find(
          (p) =>
            Number(p.id) === (days === 30 ? 26 : 25) &&
            Number(p.is_trial) === 0 &&
            Number(p.plan_duration_in_days) === days &&
            Number.isFinite(Number(p.price)) &&
            Number(p.price) > 0,
        ),
      )
      .filter(Boolean);
  }
  function savings(monthly, yearly) {
    if (!monthly || !yearly) return null;
    const amount = Number(monthly.price) * 12 - Number(yearly.price);
    return amount > 0
      ? {
          amount,
          percent: Math.round((amount / (Number(monthly.price) * 12)) * 100),
        }
      : null;
  }
  return { features, select, savings };
});

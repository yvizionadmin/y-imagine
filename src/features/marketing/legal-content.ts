import { PLANS } from "@/lib/plans";
import type { Locale } from "@/i18n/routing";
import { legalPlaceholders } from "./legal-details";

// Terms and privacy text, kept here rather than in messages/*.json so it isn't sent to the browser
// with every app page. DRAFT written from what the product does today: it needs a lawyer's review
// (see legal-details.ts). When product behaviour changes (a new outside service, retention), update this.

export type LegalSection = { title: string; paragraphs: string[] };
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };
export type LegalKind = "terms" | "privacy";

const GB = 1024 ** 3;

function build(locale: Locale): Record<LegalKind, LegalDoc> {
  const d = legalPlaceholders(locale);
  const { starter, pro, enterprise } = PLANS;
  const size = (bytes: number) => bytes / GB;

  if (locale === "ar") {
    return {
      terms: {
        title: "شروط الخدمة",
        intro: `تنظّم هذه الشروط استخدامك لخدمة إيماجن AI التي تقدّمها ${d.company} (“نحن”). باستخدام الخدمة فإنك توافق على هذه الشروط نيابةً عن نفسك وعن المؤسسة التي تمثّلها.`,
        sections: [
          { title: "الخدمة", paragraphs: ["إيماجن AI مساحة عمل لفرق التجارة الإلكترونية لإنشاء صور المنتجات والفيديو والنصوص باستخدام مزوّدي الذكاء الاصطناعي الذين تختارهم."] },
          { title: "الحسابات والأدوار", paragraphs: ["أنت مسؤول عن صحة بيانات حسابك وسرية كلمة المرور وعن كل ما يحدث ضمن مؤسستك. يحدد مسؤولو المؤسسة أعضاءها وأدوارهم (مسؤول، محرر، مشاهد)."] },
          { title: "مفاتيح مزوّدي الذكاء الاصطناعي وتكاليفها", paragraphs: ["تعمل الخدمة بمفاتيحك الخاصة لدى مزوّدي الذكاء الاصطناعي. يحاسبك المزوّد مباشرةً على استخدامك وفق شروطه، وأي تكلفة نعرضها هي تقدير فقط. أنت مسؤول عن التزامك بشروط كل مزوّد.", "الأرصدة في إيماجن AI هي حصة شهرية من المهام ضمن باقتك، وليست أموالًا ولا تُسترد نقدًا."] },
          { title: "الباقات والدفع", paragraphs: ["تُدار الاشتراكات المدفوعة عبر Stripe، وتُدفع شهريًا أو سنويًا بالسعر المعروض عند الدفع، وتتجدد تلقائيًا حتى تلغيها. عند الإلغاء تبقى باقتك فعّالة حتى نهاية الفترة المدفوعة ثم تنتقل مساحة العمل إلى الباقة المجانية. قد نقدّم فترة تجريبية مجانية لأول اشتراك.", `الاسترداد: ${d.refunds}.`] },
          { title: "الاستخدام المقبول", paragraphs: ["لا يجوز لك استخدام الخدمة في أي نشاط غير قانوني، أو لانتحال شخصية الآخرين، أو لإنشاء محتوى يضلّل الآخرين بشأن شخص حقيقي أو يسيء إليه، أو لانتهاك حقوق الآخرين، أو لمحاولة تجاوز حدود الخدمة أو أمنها.", "عند رفع صورة قد تُظهر شخصًا حقيقيًا لإنشاء فيديو، تؤكد أن لديك حقوق استخدامها وأن كل شخص يمكن التعرّف عليه فيها قد وافق على ذلك. ونسجّل هذا التأكيد."] },
          { title: "محتواك والمحتوى المُنشأ", paragraphs: ["يبقى محتواك لك. تمنحنا الإذن بتخزينه ومعالجته وإرساله إلى المزوّدين الذين اخترتهم، وذلك لتقديم الخدمة فقط. قد لا تكون نتائج الذكاء الاصطناعي دقيقة أو فريدة، فعليك مراجعتها قبل استخدامها أو نشرها، وأنت مسؤول عما تنشره."] },
          { title: "التخزين ومدة الحفظ", paragraphs: [`لكل باقة مساحة لمقاطع الفيديو: ${size(starter.videoStorageBytes)} غ.ب في Starter (تُحفظ ${starter.videoRetentionDays} يومًا)، و${size(pro.videoStorageBytes)} غ.ب في Pro (تُحفظ ${pro.videoRetentionDays} يومًا)، و${size(enterprise.videoStorageBytes)} غ.ب في Enterprise (تُحفظ ${enterprise.videoRetentionDays} يومًا). تُحذف المقاطع الأقدم تلقائيًا، وقد يؤدي خفض الباقة إلى تقصير المدة. احتفظ بنسخة من كل ما تحتاج إليه.`] },
          { title: "التوفر والتعليق", paragraphs: ["نعمل على إبقاء الخدمة متاحة لكننا لا نضمن عملها دون انقطاع، فقد تتوقف بسبب الصيانة أو بسبب المزوّدين. يجوز لنا تعليق أو إنهاء أي حساب يخالف هذه الشروط. ويمكنك التوقف عن استخدام الخدمة في أي وقت."] },
          { title: "إخلاء المسؤولية وحدودها", paragraphs: [`تُقدَّم الخدمة “كما هي” في حدود ما يسمح به القانون. ${d.liabilityCap}.`] },
          { title: "التغييرات والقانون الحاكم", paragraphs: [`قد نحدّث هذه الشروط وسننشر النسخة الجديدة هنا، ويعني استمرارك في استخدام الخدمة قبولها. تخضع هذه الشروط لما يلي: ${d.law}.`] },
          { title: "التواصل", paragraphs: [`${d.company}، ${d.address}. البريد الإلكتروني: ${d.email}.`] },
        ],
      },
      privacy: {
        title: "سياسة الخصوصية",
        intro: `توضح هذه السياسة البيانات التي تجمعها ${d.company} عند استخدامك إيماجن AI وكيف نستخدمها.`,
        sections: [
          { title: "البيانات التي نجمعها", paragraphs: ["بيانات الحساب: الاسم والبريد الإلكتروني واسم الشركة والدور.", "محتوى مؤسستك: النصوص والصور المرفوعة والنتائج المُنشأة ورسائل المحادثة وبيانات المنتجات من المتاجر التي تربطها.", "المفاتيح: مفاتيح مزوّدي الذكاء الاصطناعي وبيانات اعتماد المتاجر، مشفّرة وهي مخزّنة، ولا تُعاد إلى المتصفح أبدًا.", "الفوترة: يتولى Stripe بيانات البطاقة، ونحتفظ بمعرّفات العميل والاشتراك وحالة الاشتراك فقط.", "بيانات الاستخدام: المهام والأرصدة المستخدمة والمزوّد المستخدم وسجل النشاط وتقارير الأخطاء."] },
          { title: "كيف نستخدمها", paragraphs: ["لتقديم الخدمة وتأمينها وإصلاح الأعطال، واحتساب الأرصدة، وإرسال رسائل الخدمة مثل الدعوات وإعادة تعيين كلمة المرور. لا نبيع بياناتك. ولا نستخدم أدوات تتبّع إعلانية أو تحليلية من أطراف خارجية في الموقع."] },
          { title: "من يتلقى البيانات", paragraphs: ["مزوّدو الذكاء الاصطناعي الذين تختارهم (OpenAI وAnthropic وGoogle Gemini وOpenRouter وBytePlus): تُرسل إليهم نصوصك وصورك بمفتاحك الخاص، وتسري عليها شروطهم.", "مزوّدو الخدمة لدينا: Railway (الاستضافة وقاعدة البيانات والتخزين)، وStripe (الدفع)، وClerk (تسجيل الدخول)، وResend أو خادم البريد المعتمد (الرسائل)، وSentry (تقارير الأخطاء بعد إزالة البيانات الحساسة).", "الخدمات التي تربطها بنفسك، مثل متجرك أو Bitly."] },
          { title: "ملفات تعريف الارتباط", paragraphs: ["نستخدم ملفات الارتباط اللازمة فقط لإبقائك مسجّل الدخول. ويُحفظ اختيارك للمظهر في متصفحك."] },
          { title: "مدة الاحتفاظ", paragraphs: ["تُحذف مقاطع الفيديو بعد مدة الحفظ في باقتك. تبقى المحادثات وعناصر السجل حتى تحذفها أو تُغلق مؤسستك.", `بعد إغلاق الحساب: ${d.retention}.`] },
          { title: "الأمان", paragraphs: ["تُشفَّر المفاتيح وبيانات الاعتماد بتقنية AES-256-GCM، وتُفصل بيانات كل مؤسسة عن غيرها، ولا يمكن إدارة المفاتيح إلا لمسؤولي المؤسسة. ولا يوجد نظام آمن تمامًا."] },
          { title: "حقوقك", paragraphs: [`يمكنك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها عبر ${d.email}. وقد تكون لك حقوق إضافية بحسب بلدك. قد تُعالج البيانات خارج بلدك.`] },
          { title: "التغييرات والتواصل", paragraphs: [`سننشر أي تحديث لهذه السياسة هنا. للتواصل: ${d.company}، ${d.address}، ${d.email}.`] },
        ],
      },
    };
  }

  return {
    terms: {
      title: "Terms of Service",
      intro: `These terms govern your use of Imagine AI, provided by ${d.company} (“we”). By using the service you accept them for yourself and for the organization you represent.`,
      sections: [
        { title: "The service", paragraphs: ["Imagine AI is a workspace for e-commerce teams to create product images, video and copy using AI providers you choose."] },
        { title: "Accounts and roles", paragraphs: ["You are responsible for accurate account details, for keeping your password safe, and for what happens in your organization. Organization admins decide who the members are and their roles (admin, editor, viewer)."] },
        { title: "AI provider keys and costs", paragraphs: ["The service runs on your own keys with AI providers. The provider bills you directly for what you use, under its own terms; any cost we show is only an estimate. You are responsible for following each provider's terms.", "Credits in Imagine AI are your plan's monthly quota of jobs. They are not money and can't be exchanged for cash."] },
        { title: "Plans and payment", paragraphs: ["Paid subscriptions run through Stripe, monthly or yearly, at the price shown at checkout, and renew until you cancel. If you cancel, your plan stays active until the end of the paid period, then the workspace moves to the Free plan. We may offer a free trial on a first subscription.", `Refunds: ${d.refunds}.`] },
        { title: "Acceptable use", paragraphs: ["You may not use the service for anything illegal, to impersonate others, to create content that deceives people about or harms a real person, to infringe others' rights, or to get around the service's limits or security.", "When you upload an image for a video that may show a real person, you confirm that you have the rights to it and that anyone recognisable in it has agreed. We keep a record of that confirmation."] },
        { title: "Your content and AI output", paragraphs: ["Your content stays yours. You allow us to store it, process it and send it to the providers you chose, only to run the service. AI output may be inaccurate or not unique, so review it before you use or publish it. You are responsible for what you publish."] },
        { title: "Storage and retention", paragraphs: [`Each plan includes room for video clips: ${size(starter.videoStorageBytes)} GB on Starter (kept ${starter.videoRetentionDays} days), ${size(pro.videoStorageBytes)} GB on Pro (kept ${pro.videoRetentionDays} days) and ${size(enterprise.videoStorageBytes)} GB on Enterprise (kept ${enterprise.videoRetentionDays} days). Older clips are removed automatically, and moving to a lower plan can shorten the period. Keep a copy of anything you need.`] },
        { title: "Availability and suspension", paragraphs: ["We work to keep the service available but don't promise it will run without interruption; maintenance or providers can stop it. We may suspend or close accounts that break these terms. You can stop using the service at any time."] },
        { title: "Disclaimer and liability", paragraphs: [`The service is provided “as is” to the extent the law allows. ${d.liabilityCap}.`] },
        { title: "Changes and governing law", paragraphs: [`We may update these terms and will publish the new version here; continuing to use the service means you accept it. Governing law: ${d.law}.`] },
        { title: "Contact", paragraphs: [`${d.company}, ${d.address}. Email: ${d.email}.`] },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      intro: `This policy explains what ${d.company} collects when you use Imagine AI and how we use it.`,
      sections: [
        { title: "What we collect", paragraphs: ["Account details: name, email, company name and role.", "Your organization's content: prompts, uploaded images, generated results, chat messages, and product data from stores you connect.", "Keys: AI provider keys and store credentials, encrypted at rest and never returned to the browser.", "Billing: Stripe handles card details; we keep only customer and subscription ids and the subscription's status.", "Usage: jobs, credits used, the provider used, activity logs and error reports."] },
        { title: "How we use it", paragraphs: ["To run and secure the service, fix problems, count credits, and send service emails such as invitations and password resets. We don't sell your data, and the site uses no third-party advertising or analytics trackers."] },
        { title: "Who receives it", paragraphs: ["The AI providers you choose (OpenAI, Anthropic, Google Gemini, OpenRouter, BytePlus): your prompts and images are sent to them with your own key, under their terms.", "Our service providers: Railway (hosting, database, storage), Stripe (payments), Clerk (sign-in), Resend or our configured mail server (email), and Sentry (error reports, with sensitive data removed).", "Services you connect yourself, such as your store or Bitly."] },
        { title: "Cookies", paragraphs: ["We use only the cookies needed to keep you signed in. Your theme choice is stored in your browser."] },
        { title: "How long we keep it", paragraphs: ["Video clips are removed after your plan's retention period. Chats and History items stay until you delete them or your organization closes.", `After an account closes: ${d.retention}.`] },
        { title: "Security", paragraphs: ["Keys and credentials are encrypted with AES-256-GCM, each organization's data is kept separate, and only organization admins can manage keys. No system is perfectly secure."] },
        { title: "Your rights", paragraphs: [`You can ask to see, correct or delete your data at ${d.email}. You may have further rights depending on where you live. Data may be processed outside your country.`] },
        { title: "Changes and contact", paragraphs: [`We will publish any update to this policy here. Contact: ${d.company}, ${d.address}, ${d.email}.`] },
      ],
    },
  };
}

export const legalDoc = (locale: Locale, kind: LegalKind): LegalDoc => build(locale)[kind];

// Sample data for the design prototype. Nothing here is persisted.
export const brands = [
  { id: "b1", name: "Northwind Solar", domain: "northwindsolar.com", tz: "America/New_York", color: "oklch(0.7 0.16 70)", agents: 6, chats: 412, publicId: "nw_7f3a91" },
  { id: "b2", name: "Lumen Dental", domain: "lumendental.co", tz: "Europe/London", color: "oklch(0.62 0.15 200)", agents: 4, chats: 238, publicId: "ld_2c81be" },
  { id: "b3", name: "Atlas Movers", domain: "atlasmovers.io", tz: "Asia/Karachi", color: "oklch(0.6 0.19 25)", agents: 3, chats: 157, publicId: "am_91d0f4" },
];

export const conversations = [
  { id: "c1", name: "Maria Lopez", brand: "Northwind Solar", last: "Can I get a quote for a 6kW system?", time: "2m", unread: 2, status: "open", dept: "Sales" },
  { id: "c2", name: "Visitor #4821", brand: "Lumen Dental", last: "Do you accept new patients on Saturdays?", time: "6m", unread: 1, status: "open", dept: "Front desk" },
  { id: "c3", name: "James Okafor", brand: "Atlas Movers", last: "Thanks, the callback time works.", time: "18m", unread: 0, status: "pending", dept: "Bookings" },
  { id: "c4", name: "Priya Shah", brand: "Northwind Solar", last: "What financing options do you offer?", time: "1h", unread: 0, status: "open", dept: "Sales" },
  { id: "c5", name: "Visitor #4790", brand: "Atlas Movers", last: "Offline message: need movers on the 14th", time: "3h", unread: 0, status: "closed", dept: "Bookings" },
];

export const messages = [
  { from: "bot", text: "Hi there! 👋 How can we help today?", time: "10:02" },
  { from: "visitor", text: "Get a quote", time: "10:02" },
  { from: "visitor", text: "Can I get a quote for a 6kW system? We're in Albany.", time: "10:03" },
  { from: "agent", text: "Absolutely, Maria. Roughly how much is your monthly electric bill?", time: "10:04" },
  { from: "visitor", text: "Around $180 in summer.", time: "10:05" },
];

export const visitors = [
  { id: "v1", label: "Visitor #4830", brand: "Northwind Solar", page: "/pricing", time: "4m 12s", location: "Boston, US", source: "google / cpc", returning: true },
  { id: "v2", label: "Visitor #4831", brand: "Lumen Dental", page: "/services/implants", time: "1m 40s", location: "Leeds, UK", source: "direct", returning: false },
  { id: "v3", label: "Daniel Kim", brand: "Northwind Solar", page: "/financing", time: "7m 03s", location: "Albany, US", source: "newsletter", returning: true },
  { id: "v4", label: "Visitor #4833", brand: "Atlas Movers", page: "/quote", time: "0m 52s", location: "Lahore, PK", source: "facebook / social", returning: false },
];

export const contacts = [
  { name: "Maria Lopez", email: "maria@example.com", brand: "Northwind Solar", stage: "Qualified", owner: "Ayesha K.", created: "Oct 26" },
  { name: "James Okafor", email: "j.okafor@example.com", brand: "Atlas Movers", stage: "Callback", owner: "Omar R.", created: "Oct 25" },
  { name: "Priya Shah", email: "priya.s@example.com", brand: "Northwind Solar", stage: "New", owner: "—", created: "Oct 25" },
  { name: "Tom Becker", email: "tomb@example.com", brand: "Lumen Dental", stage: "Won", owner: "Sara L.", created: "Oct 22" },
  { name: "Hina Malik", email: "hina@example.com", brand: "Atlas Movers", stage: "Lost", owner: "Omar R.", created: "Oct 20" },
];

export const team = [
  { name: "Ayesha Khan", email: "ayesha@brandconnect.app", role: "Organization owner", brands: "All", status: "online" },
  { name: "Omar Raza", email: "omar@brandconnect.app", role: "Brand manager", brands: "Atlas Movers", status: "away" },
  { name: "Sara Lee", email: "sara@brandconnect.app", role: "Agent", brands: "Lumen Dental", status: "online" },
  { name: "Ben Ford", email: "ben@brandconnect.app", role: "Agent", brands: "Northwind Solar", status: "offline" },
  { name: "Leah Cho", email: "leah@brandconnect.app", role: "Read-only analyst", brands: "All", status: "offline" },
];

export const triggers = [
  { name: "Pricing page welcome", brand: "Northwind Solar", when: "Path is /pricing · after 10s", action: "Show teaser + quick replies", impressions: 1840, chats: 212, enabled: true },
  { name: "Exit intent offer", brand: "Lumen Dental", when: "Desktop exit intent · first visit", action: "Offer free consultation", impressions: 920, chats: 64, enabled: true },
  { name: "Returning visitor", brand: "Atlas Movers", when: "Returning · scroll 50%", action: "Automated greeting", impressions: 410, chats: 38, enabled: false },
];

export const canned = [
  { shortcut: "/hours", title: "Opening hours", brand: "All brands", text: "We're available Monday–Friday, 9am–6pm local time." },
  { shortcut: "/quote", title: "Quote follow-up", brand: "Northwind Solar", text: "Thanks! Could you share your address and average monthly bill?" },
  { shortcut: "/callback", title: "Callback confirm", brand: "Atlas Movers", text: "Perfect, a coordinator will call you at the time you chose." },
  { shortcut: "/insurance", title: "Insurance", brand: "Lumen Dental", text: "We accept most major dental insurance plans." },
];

export const audit = [
  { when: "Oct 27, 06:52", actor: "Ayesha Khan", action: "Updated widget colors", target: "Northwind Solar" },
  { when: "Oct 27, 06:10", actor: "Omar Raza", action: "Exported leads (CSV)", target: "Atlas Movers" },
  { when: "Oct 26, 19:44", actor: "Ayesha Khan", action: "Invited agent", target: "leah@brandconnect.app" },
  { when: "Oct 26, 15:02", actor: "Sara Lee", action: "Closed conversation", target: "Visitor #4790" },
  { when: "Oct 26, 11:30", actor: "System", action: "Trigger paused (frequency cap)", target: "Returning visitor" },
];

export const weekly = [
  { day: "Mon", chats: 82, leads: 21 }, { day: "Tue", chats: 96, leads: 27 }, { day: "Wed", chats: 110, leads: 30 },
  { day: "Thu", chats: 104, leads: 26 }, { day: "Fri", chats: 128, leads: 38 }, { day: "Sat", chats: 64, leads: 14 }, { day: "Sun", chats: 51, leads: 11 },
];

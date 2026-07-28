import { prisma, seedUsers, seedProject, type ProjectSeed } from "./seed";

// Adds more demo projects on top of whatever already exists — doesn't touch or reset
// existing data. Reuses seed.ts's scenario logic (just_started, site_visit_blocked,
// etc.) with new names/details, skewed toward exercising the dashboard's alert tiers
// (more blocked/delayed situations, more overdue steps, more pending payments) so
// there's something real to look at instead of a handful of near-empty tiles.
const EXTRA_PROJECT_SEEDS: ProjectSeed[] = [
  {
    name: "Sunrise Apartments Glazing",
    clientName: "Ramesh Iyer",
    clientPhone: "9876500011",
    clientAddress: "Sunrise Apartments, Wing C, Nashik",
    finalCost: 1180000,
    glassType: "normal",
    createdDaysAgo: 3,
    scenario: "site_visit_blocked",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Metro Tower Curtain Wall",
    clientName: "Ananya Corp Pvt Ltd",
    clientPhone: "9876500012",
    clientAddress: "Metro Business Tower, Sector 21, Gurgaon",
    finalCost: 1490000,
    glassType: "laminated",
    createdDaysAgo: 40,
    scenario: "phase2_blocked_vendor",
    paymentStatus: "partial",
    amountReceived: 600000,
  },
  {
    name: "Hilltop Villa Windows",
    clientName: "Kavita Rao",
    clientPhone: "9876500013",
    clientAddress: "Hilltop Layout, Manali Road, Coimbatore",
    finalCost: 1020000,
    glassType: "normal",
    createdDaysAgo: 1,
    scenario: "just_started",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Silver Oak Residency",
    clientName: "Manoj Verma",
    clientPhone: "9876500014",
    clientAddress: "Silver Oak Residency, Baner, Pune",
    finalCost: 1330000,
    glassType: "normal",
    createdDaysAgo: 8,
    scenario: "phase1_in_progress",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Emerald Heights Facade",
    clientName: "Deepa Krishnan",
    clientPhone: "9876500015",
    clientAddress: "Emerald Heights, ECR, Chennai",
    finalCost: 1470000,
    glassType: "laminated",
    createdDaysAgo: 28,
    scenario: "phase2_procuring",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Golden Gate Apartments",
    clientName: "Ravi Shankar",
    clientPhone: "9876500016",
    clientAddress: "Golden Gate Apartments, Whitefield, Bengaluru",
    finalCost: 1110000,
    glassType: "normal",
    createdDaysAgo: 55,
    scenario: "phase3_installing",
    paymentStatus: "partial",
    amountReceived: 850000,
  },
  {
    name: "Blue Lagoon Resort Glazing",
    clientName: "Blue Lagoon Resorts Pvt Ltd",
    clientPhone: "9876500017",
    clientAddress: "Blue Lagoon Resort, ECR, Puducherry",
    finalCost: 1500000,
    glassType: "laminated",
    createdDaysAgo: 80,
    scenario: "completed",
    paymentStatus: "received",
    amountReceived: 1500000,
  },
  {
    name: "Pinewood Cottage Windows",
    clientName: "Neha Joshi",
    clientPhone: "9876500018",
    clientAddress: "Pinewood Cottages, Mall Road, Shimla",
    finalCost: 990000,
    glassType: "normal",
    createdDaysAgo: 2,
    scenario: "site_visit_blocked",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Skyline Business Park",
    clientName: "Skyline Corp",
    clientPhone: "9876500019",
    clientAddress: "Skyline Business Park, Hitech City, Hyderabad",
    finalCost: 1500000,
    glassType: "laminated",
    createdDaysAgo: 45,
    scenario: "phase2_blocked_vendor",
    paymentStatus: "partial",
    amountReceived: 700000,
  },
  {
    name: "Orchid Residency Facade",
    clientName: "Sanjay Mehta",
    clientPhone: "9876500020",
    clientAddress: "Orchid Residency, S.G. Highway, Ahmedabad",
    finalCost: 1250000,
    glassType: "normal",
    createdDaysAgo: 30,
    scenario: "phase2_procuring",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Cedar Court Apartments",
    clientName: "Pooja Nair",
    clientPhone: "9876500021",
    clientAddress: "Cedar Court, Kakkanad, Kochi",
    finalCost: 1080000,
    glassType: "normal",
    createdDaysAgo: 12,
    scenario: "phase1_in_progress",
    paymentStatus: "partial",
    amountReceived: 300000,
  },
  {
    name: "Maple Grove Villa",
    clientName: "Arjun Kapoor",
    clientPhone: "9876500022",
    clientAddress: "Maple Grove Layout, Kharadi, Pune",
    finalCost: 1150000,
    glassType: "normal",
    createdDaysAgo: 0,
    scenario: "just_started",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Harbor View Condos",
    clientName: "Harbor Living Pvt Ltd",
    clientPhone: "9876500023",
    clientAddress: "Harbor View Condos, Marine Drive, Kochi",
    finalCost: 1480000,
    glassType: "laminated",
    createdDaysAgo: 60,
    scenario: "phase3_installing",
    paymentStatus: "partial",
    amountReceived: 950000,
  },
  {
    name: "Rosewood Enclave",
    clientName: "Vikram Singh",
    clientPhone: "9876500024",
    clientAddress: "Rosewood Enclave, Vaishali Nagar, Jaipur",
    finalCost: 1050000,
    glassType: "normal",
    createdDaysAgo: 90,
    scenario: "completed",
    paymentStatus: "received",
    amountReceived: 1050000,
  },
  {
    name: "Starlight Towers",
    clientName: "Starlight Developers",
    clientPhone: "9876500025",
    clientAddress: "Starlight Towers, Viman Nagar, Pune",
    finalCost: 1500000,
    glassType: "laminated",
    createdDaysAgo: 33,
    scenario: "phase2_procuring",
    paymentStatus: "pending",
    amountReceived: 0,
  },
];

async function main() {
  console.log("Ensuring demo users exist...");
  const users = await seedUsers();

  console.log(`Adding ${EXTRA_PROJECT_SEEDS.length} more demo projects...`);
  for (const seed of EXTRA_PROJECT_SEEDS) {
    await seedProject(seed, users);
    console.log(`  created "${seed.name}" (${seed.scenario})`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


<!-- 
owner@sgd.demo	password123	Owner / Admin (sees /dashboard)
hr@sgd.demo	password123	HR & Admin
engineer@sgd.demo	password123	Project Engineer
design@sgd.demo	password123	Design Engineer
purchase@sgd.demo	password123	Purchase
accounts@sgd.demo	password123	Accounts -->


In , https://sgd-project-management.vercel.app/projects/cmu250nbe002ljq042p664wub

live project - i skipped work to phase 3 , but I can see that, whn triting to mark Glass PO -> Requirement created -> actual  based on its planned date filled before does not shows due messages and also check the Progress overview attached - phase 3 - Glass PO: requirement, quote, payment - shows no color 

------------
------------

in /services - 'Status' coloumn , if all task complted example if 'Work items' is '1 / 3 done' then chnage service status as "no pending task"


------------
------------


next is an existing issue in live


In , https://sgd-project-management.vercel.app/projects/cmu250nbe002ljq042p664wub

live project - i skipped work to phase 3 , but I can see that, when trying to mark Glass PO -> Requirement created -> actual  based on its planned date filled before , it does not shows due messages and also - check the Progress overview attached - phase 3 - Glass PO: requirement, quote, payment - shows no color 

------------
------------

when tring to block a project - when confirm  block need to open a modal to add tasks like "Additional works" - also show these tasks in   Additional works with an extra badge blocked 
-------

for DIJIL this project - in http://localhost:3000/projects/cmuce6b4h0090lc04lthje2be i can see that hardware and gasket are due but section is on time and with no due 
but in http://localhost:3000/projects page - in its Status coloumn shwing  
'Delayed · 4d
Section arrival — overdue since 18 Sept'

could youcheck this ??


----

Additional works - should have an edit option everyware to edit anyting like  task, planned date, actual date etc

---


in http://localhost:3000/my-tasks 
when  logged as project engineer - for

Installation
Phase 3

and


Aluminum framework
Phase 3

in Planned date column - mention what date it is actually weather it is a planned start date or planned end

eg: 18 Sept 2026 (planned start date)
Overdue 4d



------


in http://localhost:3000/projects need an text type input filter , to find project easly



---------
-- imp... http://localhost:3000/projects/cmucbg1aq0017jx049ovlee4u  Phase 3 · Installation Forecast is alraedy present and the dates are avilable 
is not there in installation report
----imp..  customer review tasks are not availabel in hr login
---imp.  3E Final QC on site planned date edit -- opraton manager and owner 
---imp... final tight meshurent  data planned date custum ---- 
always show phase 3 installation forcast card 
---  Phase-3
        directly under 'Phase 3 · Installation' need a new table like  'Glass PO'
        head line  - Production material Delivery            
        -- purchase dept.
                        Section - planned - actual - delay reason -  mark complete
                        Hardware - planned - actual - delay reason - mark complete
                        Gasket - planned - actual - delay reason -mark complete
                        (Above 3 purchase)
        --- design 
                        Cutting list - planned - actual - delay reason - markcomplete
                        Elevation drawing  - planned - actual - delay reason - mark complete
        no need to change current work flow thease are handled manually , but add this tasks under respective department







--- phase 1 bloakced , then phase 2 and 3 , temproraryy blocked
--- need a revert option in 2A Purchase requirement (section, hardware, gasket) , all a data after this step should be removed , ask skope

-- need a modal while clicking 'confirm blocked ' , that should allow to add tasks like additinal work with a badge bloked work tasks

if user adds 3 tasks in it or there is no tasks need to show that in a separate coloum ater status


----imp..last.. in operation manager login -  every depplatments open work shuld have a filter to flter based on departments

---- phase 3 last - need additinal revirew card to ask 'website review' yes/no -- hr departmet

---- operation magers 'my tasks' should be also visibile to owner

--- project engineer should also have option to view every pages like opernation mager



--- in /my-tasks - planned end date ,  in task coloum 'Installation Phase 3 (end)'


 --- 























The fix: when a project is skipped to Phase 2/3 (skipToPhase), every step and procurement stage it backfills now gets auto-marked as reviewed at the same moment, instead of landing in the Operations Manager's review queue.
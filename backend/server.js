// Import required modules
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const fs = require("fs").promises;
require("dotenv").config(); // Load environment variables
const cheerio = require("cheerio");
const axios = require("axios");
const cron = require("node-cron");
const PORT = process.env.PORT || 5000;

// Initialize PostgreSQL pool using environment variable
const pool = new Pool({
  connectionString:"postgresql://xrjobs_urp4_user:2lkJMgRTYllld0VMT3h7y3xYfL5SRmk1@dpg-cvajip7noe9s73fabcqg-a.oregon-postgres.render.com/xrjobs_urp4",
  ssl: {
    rejectUnauthorized: false, // This bypasses certificate verification
  },
});

// Initialize Express app
const app = express();

// Parser functions

// Naukri Parser Implementation
async function naukriParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    // Naukri job listings are often in elements like "article.jobTuple" or "div.jobTuple"
    $("article.jobTuple, div.jobTuple").each((i, el) => {
      try {
        const titleElem = $(el).find("a.title");
        const companyElem = $(el).find("a.subTitle");
        const locationElem = $(el).find(".location");
        const salaryElem = $(el).find(".salary");
        const dateElem = $(el).find(".date");

        // Validate required fields
        if (!titleElem.length || !companyElem.length) {
          console.log("Skipping Naukri element - missing title or company");
          return;
        }

        const title = titleElem.text().trim();
        const company = companyElem.text().trim();
        const location = locationElem.text().trim();
        const salary = salaryElem.text().trim() || "Not disclosed";
        const apply_link = titleElem.attr("href")
          ? titleElem.attr("href").split("?")[0]
          : "";
        const description =
          $(el).find(".job-description").text().trim() ||
          "Check company website for details";

        // Parse date posted; if relative (e.g., "2 days ago"), convert to a real date
        let datePostedRaw = dateElem.text().trim();
        let datePosted;
        const dayMatch = datePostedRaw.match(/(\d+)\s+day/);
        if (dayMatch) {
          const days = parseInt(dayMatch[1]);
          let d = new Date();
          d.setDate(d.getDate() - days);
          datePosted = d.toISOString().split("T")[0];
        } else {
          // Fallback to current date
          datePosted = new Date().toISOString().split("T")[0];
        }

        // Use default image if not provided
        const image_link = "/company-logos/default.png";
        const job_type = "Full-time";
        const experience = "Fresher";
        const batch = "N/A";

        // Helpers to generate URL slug
        function slugifyCompany(text) {
          return text.toLowerCase().replace(/\s+/g, "");
        }
        function slugify(text) {
          return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
        }
        const companySlug = slugifyCompany(company);
        const locationSlug = slugify(location);
        const salarySlug = slugify(salary);
        const constructedUrl = `${companySlug}-${locationSlug}-${salarySlug}`;

        jobs.push({
          companyname: companySlug,
          title,
          description,
          apply_link,
          image_link,
          url: constructedUrl,
          salary,
          location,
          job_type,
          experience,
          batch,
          date_posted: datePosted,
          job_uploader: "Naukri Scraper",
        });
      } catch (err) {
        console.error("Error parsing Naukri job element:", err);
      }
    });
  } catch (err) {
    console.error("Naukri parser error:", err);
  }
  console.log(`Parsed ${jobs.length} jobs from Naukri`);
  return jobs;
}

// Enhanced LinkedIn Parser
async function linkedInParser(html) {
  const jobs = [];

  // Helpers
  function slugifyCompany(text) {
    return text.toLowerCase().replace(/\s+/g, "");
  }
  function slugify(text) {
    return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
  }

  try {
    const $ = cheerio.load(html);
    
    // Updated container selector to div.base-card
    $("div.base-card").each((i, el) => {
      try {
        const titleElem = $(el).find(".base-search-card__title");
        const companyElem = $(el).find(".base-search-card__subtitle");
        const locationElem = $(el).find(".job-search-card__location");
        const linkElem = $(el).find("a.base-card__full-link");
        const description = $(el).find(".job-search-card__description").text().trim();

        if (!titleElem.length || !companyElem.length) {
          console.log("Skipping element - missing title or company");
          return;
        }

        const title = titleElem.text().trim();
        const company = companyElem.text().trim().replace(/\s+/g, " ");
        const location = locationElem.text().trim();
        const rawUrl = linkElem.attr("href") || "";

        const cleanUrl = rawUrl.split("?")[0]
          .replace(/\/\//g, "/")
          .replace("https:/", "https://");

        // Extract experience & salary from description or title
        const experienceMatch = description.match(/(\d+-\d+\s+years? experience|fresher|entry level)/i)
          || title.match(/(fresher|entry level)/i);
        const salaryMatch = description.match(/(₹[\d,]+ - ₹[\d,]+)\s*(?:per\syear|a\syear)/i);

        // Get company image
        const logoElem = $(el).find("img.artdeco-entity-image");
        let companyImage = logoElem.attr("data-delayed-url") || logoElem.attr("src");

        // Validate and normalize date posted
        let timeAttr = $(el).find("time").attr("datetime");
        let datePosted;
        if (timeAttr) {
          const parsedDate = new Date(timeAttr);
          datePosted = isNaN(parsedDate) ? new Date().toISOString().split("T")[0] : parsedDate.toISOString().split("T")[0];
        } else {
          datePosted = new Date().toISOString().split("T")[0];
        }

        // Construct URL slug
        const companySlug = slugifyCompany(company);
        const locationSlug = slugify(location);
        const salaryValue = salaryMatch ? salaryMatch[1] : "not disclosed";
        const salarySlug = slugify(salaryValue);
        const constructedUrl = `${companySlug}-${locationSlug}-${salarySlug}`;

        jobs.push({
          companyname: companySlug,
          title,
          description: description || "Check company website for details",
          apply_link: cleanUrl,
          image_link: companyImage || "/company-logos/default.png",
          url: constructedUrl,
          salary: salaryMatch ? salaryMatch[1] : "Not disclosed",
          location,
          job_type: description.includes("Part-time") ? "Part-time" : "Full-time",
          experience: experienceMatch ? experienceMatch[0] : "Fresher",
          batch: "N/A",
          date_posted: datePosted,
          job_uploader: "LinkedIn Scraper",
        });
      } catch (err) {
        console.error("Error parsing job element:", err);
      }
    });
  } catch (err) {
    console.error("LinkedIn parser error:", err);
  }
  
  console.log(`Parsed ${jobs.length} jobs from current page`);
  // Uncomment the filter below if you want to restrict to fresher/entry-level jobs only
  // return jobs.filter(job => 
  //   /(fresher|entry level|0-2 years)/i.test(job.title) &&
  //   !/(senior|manager|lead|sr\.)/i.test(job.title)
  // );
  return jobs;
}

// Job source configurations
const jobSources = [
  {
    name: "LinkedIn Developers",
    type: "api",
    url: (page) => {
      const keywords = encodeURIComponent(`"software developer" (fresher OR entry level)`);
      return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${keywords}&location=India&start=${page * 25}`;
    },
    parser: linkedInParser,
    pages: 5, // Adjust this number to scrape more pages if needed
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      Referer: "https://www.linkedin.com/jobs/",
    },
  },
  {
    name: "LinkedIn Testers",
    type: "api",
    url: (page) =>
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=(qa%20tester%20(fresher%20OR%20entry%20level))%20OR%20(quality%20assurance%20(fresher%20OR%20entry%20level))&location=India&start=${page * 25}`,
    parser: linkedInParser,
    pages: 20,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
    },
  },
  {
    name: "Naukri",
    type: "puppeteer",
    url: "https://www.naukri.com/fresher-software-developer-jobs-in-india",
    parser: naukriParser,
  },
];

// Enhanced scrapeJobs function with delays
const scrapeJobs = async () => {
  let totalJobs = 0;
  
  for (const source of jobSources) {
    try {
      console.log(`[Scraper] Scraping ${source.name}...`);
      let allJobs = [];

      if (source.type === "api") {
        for (let page = 0; page < source.pages; page++) {
          try {
            const url = typeof source.url === "function" ? source.url(page) : source.url;
            console.log(`Scraping page ${page}: ${url}`);
            
            const response = await axios.get(url, { 
              headers: source.headers,
              timeout: 30000,
            });
            
            const jobs = await source.parser(response.data);
            allJobs = [...allJobs, ...jobs];
            
            // Randomized delay between pages (5-15 seconds)
            const delay = Math.floor(Math.random() * 10000) + 5000;
            await new Promise((resolve) => setTimeout(resolve, delay));
          } catch (err) {
            console.error(`Error fetching page ${page}: ${err.message}`);
          }
        }
      } else if (source.type === "puppeteer") {
        // For sources like Naukri, you might use Puppeteer.
        // For simplicity here, we use axios to fetch the HTML.
        try {
          console.log(`Fetching Naukri page: ${source.url}`);
          const response = await axios.get(source.url, { timeout: 30000 });
          const jobs = await source.parser(response.data);
          allJobs = [...allJobs, ...jobs];
        } catch (err) {
          console.error(`Error fetching Naukri page: ${err.message}`);
        }
      }

      console.log(`Found ${allJobs.length} valid jobs from ${source.name}`);

      // Database insertion with corrected column order:
      // Order: companyname, title, description, apply_link, image_link, url, date_posted, salary, location, job_type, experience, batch, job_uploader
      for (const job of allJobs) {
        try {
          const existing = await pool.query(
            "SELECT 1 FROM job WHERE url = $1",
            [job.url]
          );
          
          if (!existing.rows.length) {
            await pool.query(
              `INSERT INTO job (
                companyname, title, description, apply_link, image_link, url, date_posted,
                salary, location, job_type, experience, batch, job_uploader
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                job.companyname,
                job.title,
                job.description,
                job.apply_link,
                job.image_link,
                job.url,
                job.date_posted,
                job.salary,
                job.location,
                job.job_type,
                job.experience,
                job.batch,
                job.job_uploader,
              ]
            );
            totalJobs++;
          }
        } catch (err) {
          console.error(`DB Error for ${job.url}:`, err.message);
        }
        // Short delay between inserts
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      // Longer delay between sources
      await new Promise((resolve) => setTimeout(resolve, 15000));
    } catch (error) {
      console.error(`[Scraper] Error in ${source.name}:`, error.message);
    }
  }
  return totalJobs;
};

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("combined"));
const corsOptions = {
  origin: "*", // Replace "*" with specific domains for production
};
app.use(cors(corsOptions));

// Initialize DB and start server
const initializeDbAndServer = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job (
        id SERIAL PRIMARY KEY,
        companyname TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        apply_link TEXT NOT NULL,
        image_link TEXT NOT NULL,
        url TEXT NOT NULL,
        salary TEXT NOT NULL,
        location TEXT NOT NULL,
        job_type TEXT NOT NULL,
        experience TEXT NOT NULL,
        batch TEXT NOT NULL,
        job_uploader TEXT NOT NULL,
        date_posted VARCHAR(50),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert jobs from file if table is empty
    const jobsCountResult = await pool.query("SELECT COUNT(*) as count FROM job;");
    const jobsCount = jobsCountResult.rows[0].count;

    if (jobsCount == 0) {
      const data = await fs.readFile("jobs.json", "utf8");
      const jobList = JSON.parse(data);

      const insertJobQuery = `
         INSERT INTO job (companyname, title, description, apply_link, image_link, url, date_posted, salary, location, job_type, experience, batch, job_uploader)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
       `;

      for (const job of jobList) {
        await pool.query(insertJobQuery, [
          job.companyname,
          job.title,
          job.description,
          job.apply_link,
          job.image_link,
          job.url,
          job.date_posted,
          job.salary,
          job.location,
          job.job_type,
          job.experience,
          job.batch,
          job.job_uploader,
        ]);
      }
      console.log("Job data has been imported successfully.");
    }

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}/`);
    });

    // Upgrade HTTP server to WebSocket if needed
    server.on("upgrade", (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });

    (async () => {
      try {
        const count = await scrapeJobs();
        console.log(`Initial scrape completed: ${count} jobs added`);
      } catch (err) {
        console.error("Initialization error:", err);
      }
    })();

    // Daily scrape at 2 AM
    cron.schedule("0 2 * * *", () => {
      console.log("[Cron] Starting daily scrape");
      scrapeJobs();
    });

  } catch (error) {
    console.error(`Error initializing the database: ${error.message}`);
    process.exit(1);
  }
};

// Route to get all jobs with pagination
app.get("/api/jobs", async (req, res) => {
  try {
    // Calculate the threshold for a "new" job (created within the last 7 days)
    const currentTime = new Date();
    const sevenDaysAgo = new Date(currentTime.setDate(currentTime.getDate() - 7));

    // Updated query without pagination
    const getAllJobsQuery = `
      SELECT *,
        CASE 
          WHEN createdAt >= $1 THEN 1 
          ELSE 0 
        END as isNew 
      FROM job 
      ORDER BY isNew DESC, createdAt DESC;
    `;

    // Pass only the date parameter
    const jobs = await pool.query(getAllJobsQuery, [sevenDaysAgo.toISOString()]);

    if (jobs.rows.length > 0) {
      res.json(jobs.rows);
    } else {
      res.status(404).json({ error: "No jobs found" });
    }
  } catch (error) {
    console.error(`Error fetching all jobs: ${error.message}`);
    res.status(500).json({ error: "Failed to retrieve jobs" });
  }
});


// Updated detail route with correct table name
app.get("/api/jobs/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM job WHERE id = $1", [req.params.id]);
    rows.length ? res.json(rows[0]) : res.status(404).json({ error: "Job not found" });
  } catch (err) {
    console.error("[API] Error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Disable caching for all responses
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

pool.connect()
  .then(() => console.log("Connected to PostgreSQL database"))
  .catch((err) => console.error("Database connection error:", err.stack));

// Root route
app.get("/", (req, res) => {
  res.send("Welcome to the Job Card Details API!");
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Connect to the database and start the server
initializeDbAndServer();

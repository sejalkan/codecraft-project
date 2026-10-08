// app.js

// Import required packages
const express = require("express");
const fs = require("fs").promises;
const path = require("path");

// Create the Express application
const app = express();

// The server will run on port 5001
const PORT = 5001;

// Path to the JSON file used for storing courses
const COURSES_FILE = path.join(__dirname, "courses.json");

// Allowed course status values
const VALID_STATUSES = [
  "Not Started",
  "In Progress",
  "Completed"
];

/*
  Middleware that allows Express to read JSON request bodies.

  For example, this allows us to read data sent in a POST request:
  {
    "name": "Node.js Basics",
    "description": "Learn Node.js fundamentals",
    "target_date": "2026-12-31",
    "status": "Not Started"
  }
*/
app.use(express.json());

/*
  Custom error class.

  This allows us to create errors with a specific HTTP status code.
  For example:
  new AppError("Course not found", 404)
*/
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

/*
  Create courses.json if it does not already exist.

  The file starts with an empty array because courses will be stored
  as an array of objects.
*/
async function initializeCoursesFile() {
  try {
    await fs.access(COURSES_FILE);

    // The file exists, so we do not need to create it.
  } catch (error) {
    // If the file does not exist, create it with an empty array.
    if (error.code === "ENOENT") {
      try {
        await fs.writeFile(
          COURSES_FILE,
          JSON.stringify([], null, 2),
          "utf8"
        );

        console.log("Created courses.json automatically.");
      } catch (writeError) {
        throw new AppError(
          `Unable to create courses.json: ${writeError.message}`,
          500
        );
      }
    } else {
      throw new AppError(
        `Unable to access courses.json: ${error.message}`,
        500
      );
    }
  }
}

/*
  Read all courses from courses.json.

  JSON.parse converts the file contents from a string into a JavaScript array.
*/
async function readCourses() {
  try {
    const fileContents = await fs.readFile(COURSES_FILE, "utf8");
    const courses = JSON.parse(fileContents);

    // Make sure the JSON file contains an array
    if (!Array.isArray(courses)) {
      throw new AppError(
        "courses.json must contain an array of courses.",
        500
      );
    }

    return courses;
  } catch (error) {
    // Preserve errors that we intentionally created
    if (error instanceof AppError) {
      throw error;
    }

    // Handle invalid JSON separately
    if (error instanceof SyntaxError) {
      throw new AppError(
        "courses.json contains invalid JSON.",
        500
      );
    }

    // Handle other file read errors
    throw new AppError(
      `Unable to read courses.json: ${error.message}`,
      500
    );
  }
}

/*
  Write the courses array back to courses.json.

  JSON.stringify converts the JavaScript array into formatted JSON text.
*/
async function writeCourses(courses) {
  try {
    await fs.writeFile(
      COURSES_FILE,
      JSON.stringify(courses, null, 2),
      "utf8"
    );
  } catch (error) {
    throw new AppError(
      `Unable to write to courses.json: ${error.message}`,
      500
    );
  }
}

/*
  Check whether a date has the exact YYYY-MM-DD format
  and represents a real calendar date.

  Examples:
  Valid:   2026-12-31
  Invalid: 12-31-2026
  Invalid: 2026-02-30
*/
function isValidDateFormat(dateString) {
  if (typeof dateString !== "string") {
    return false;
  }

  // First check the basic YYYY-MM-DD pattern
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!datePattern.test(dateString)) {
    return false;
  }

  const [year, month, day] = dateString.split("-").map(Number);

  // Create a UTC date to avoid timezone-related issues
  const date = new Date(Date.UTC(year, month - 1, day));

  // Confirm that JavaScript did not adjust the date
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/*
  Validate course data received from the client.

  The required fields are:
  - name
  - description
  - target_date
  - status
*/
function validateCourseData(courseData) {
  const requiredFields = [
    "name",
    "description",
    "target_date",
    "status"
  ];

  // Check for missing or empty fields
  for (const field of requiredFields) {
    if (
      courseData[field] === undefined ||
      courseData[field] === null ||
      String(courseData[field]).trim() === ""
    ) {
      throw new AppError(`${field} is required.`, 400);
    }
  }

  // Check that status is one of the allowed values
  if (!VALID_STATUSES.includes(courseData.status)) {
    throw new AppError(
      `Invalid status. Status must be one of: ${VALID_STATUSES.join(", ")}.`,
      400
    );
  }

  // Check the target date format
  if (!isValidDateFormat(courseData.target_date)) {
    throw new AppError(
      "target_date must use the format YYYY-MM-DD and be a valid date.",
      400
    );
  }
}

/*
  Find a course by its ID.

  IDs are stored as numbers, so the URL string is converted to a number.
*/
function findCourseById(courses, id) {
  const courseId = Number(id);

  if (!Number.isInteger(courseId) || courseId < 1) {
    return null;
  }

  return courses.find((course) => course.id === courseId);
}

/*
  POST /api/courses

  Add a new course.
*/
app.post("/api/courses", async (req, res, next) => {
  try {
    const courseData = req.body;

    // Make sure a JSON object was sent
    if (
      !courseData ||
      typeof courseData !== "object" ||
      Array.isArray(courseData)
    ) {
      throw new AppError(
        "Request body must be a JSON object.",
        400
      );
    }

    // Validate required fields and values
    validateCourseData(courseData);

    // Read existing courses
    const courses = await readCourses();

    /*
      Generate the next ID.

      If there are no courses, the first ID is 1.
      Otherwise, find the largest existing ID and add 1.
    */
    const nextId =
      courses.length === 0
        ? 1
        : Math.max(...courses.map((course) => course.id)) + 1;

    // Create the new course
    const newCourse = {
      id: nextId,
      name: String(courseData.name).trim(),
      description: String(courseData.description).trim(),
      target_date: courseData.target_date,
      status: courseData.status,
      created_at: new Date().toISOString()
    };

    // Add the new course and save the updated array
    courses.push(newCourse);
    await writeCourses(courses);

    // Return the newly created course
    res.status(201).json({
      message: "Course created successfully.",
      course: newCourse
    });
  } catch (error) {
    next(error);
  }
});

/*
  GET /api/courses

  Get all courses.
*/
app.get("/api/courses", async (req, res, next) => {
  try {
    const courses = await readCourses();

    res.status(200).json(courses);
  } catch (error) {
    next(error);
  }
});

/*
  GET /api/courses/:id

  Get one specific course by its ID.

  Example:
  GET /api/courses/1
*/
app.get("/api/courses/:id", async (req, res, next) => {
  try {
    const courses = await readCourses();
    const course = findCourseById(courses, req.params.id);

    if (!course) {
      throw new AppError("Course not found.", 404);
    }

    res.status(200).json(course);
  } catch (error) {
    next(error);
  }
});

/*
  PUT /api/courses/:id

  Replace all editable details of an existing course.

  The client must send:
  - name
  - description
  - target_date
  - status

  The ID and created_at values cannot be changed.
*/
app.put("/api/courses/:id", async (req, res, next) => {
  try {
    const courseData = req.body;

    // Make sure a JSON object was sent
    if (
      !courseData ||
      typeof courseData !== "object" ||
      Array.isArray(courseData)
    ) {
      throw new AppError(
        "Request body must be a JSON object.",
        400
      );
    }

    // PUT requires all course fields
    validateCourseData(courseData);

    const courses = await readCourses();
    const courseIndex = courses.findIndex(
      (course) => course.id === Number(req.params.id)
    );

    if (courseIndex === -1) {
      throw new AppError("Course not found.", 404);
    }

    const existingCourse = courses[courseIndex];

    // Update the course while preserving id and created_at
    const updatedCourse = {
      id: existingCourse.id,
      name: String(courseData.name).trim(),
      description: String(courseData.description).trim(),
      target_date: courseData.target_date,
      status: courseData.status,
      created_at: existingCourse.created_at
    };

    courses[courseIndex] = updatedCourse;

    await writeCourses(courses);

    res.status(200).json({
      message: "Course updated successfully.",
      course: updatedCourse
    });
  } catch (error) {
    next(error);
  }
});

/*
  DELETE /api/courses/:id

  Delete a course by its ID.
*/
app.delete("/api/courses/:id", async (req, res, next) => {
  try {
    const courses = await readCourses();
    const courseIndex = courses.findIndex(
      (course) => course.id === Number(req.params.id)
    );

    if (courseIndex === -1) {
      throw new AppError("Course not found.", 404);
    }

    // Remove one course from the array
    const deletedCourse = courses.splice(courseIndex, 1)[0];

    // Save the remaining courses
    await writeCourses(courses);

    res.status(200).json({
      message: "Course deleted successfully.",
      course: deletedCourse
    });
  } catch (error) {
    next(error);
  }
});

/*
  Handle invalid JSON sent in a request body.

  For example, this handles malformed JSON submitted to POST or PUT.
*/
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: "Request body contains invalid JSON."
    });
  }

  next(error);
});

/*
  Handle requests to routes that do not exist.
*/
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found."
  });
});

/*
  General error-handling middleware.

  This must be placed after all routes and other middleware.
*/
app.use((error, req, res, next) => {
  console.error(error);

  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    error: error.message || "Internal server error."
  });
});

/*
  Initialize the JSON file before starting the server.

  If the file cannot be created or accessed, the server will not start.
*/
async function startServer() {
  try {
    await initializeCoursesFile();

    app.listen(PORT, () => {
      console.log(`CodeCraftHub API is running on port ${PORT}`);
      console.log(`Base URL: http://localhost:${PORT}/api/courses`);
    });
  } catch (error) {
    console.error("Unable to start the server:");
    console.error(error.message);
    process.exit(1);
  }
}

// Start the application
startServer();
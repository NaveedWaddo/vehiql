"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { serializeCarData } from "@/lib/helpers";

// Function to convert File to base64
async function fileToBase64(file) {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  return buffer.toString("base64");
}

// Create service role Supabase client (bypasses RLS)
function createServiceSupabaseClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured in environment variables"
    );
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Helper function to get valid file extension
function getFileExtensionFromMimeType(mimeType) {
  const mimeToExt = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return mimeToExt[mimeType] || "jpg";
}

// Helper function to validate image data
function isValidImageData(base64Data) {
  if (!base64Data || typeof base64Data !== "string") {
    return false;
  }

  // Check if it's a valid data URL
  const dataUrlPattern = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/;
  return dataUrlPattern.test(base64Data);
}

// Add a car to the database with images
export async function addCar({ carData, images }) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    // Validate required fields
    if (
      !carData.make ||
      !carData.model ||
      isNaN(parseFloat(carData.price)) ||
      parseFloat(carData.price) <= 0
    ) {
      throw new Error(
        "Missing or invalid required fields: make, model, or price"
      );
    }

    // Validate images array
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error("At least one image is required");
    }

    // Create a unique folder name for this car's images
    const carId = uuidv4();
    const folderPath = `cars/${carId}`;

    // Initialize Supabase client with service role (bypasses RLS)
    const supabase = createServiceSupabaseClient();

    // Upload all images to Supabase storage
    const imageUrls = [];
    const uploadPromises = [];

    for (let i = 0; i < images.length; i++) {
      const base64Data = images[i];

      // Validate image data
      if (!isValidImageData(base64Data)) {
        console.warn(`Skipping invalid image data at index ${i}`);
        continue;
      }

      // Extract MIME type and base64 data
      const mimeTypeMatch = base64Data.match(/data:image\/([^;]+);base64,/);
      if (!mimeTypeMatch) {
        console.warn(`Could not extract MIME type from image at index ${i}`);
        continue;
      }

      const mimeType = `image/${mimeTypeMatch[1]}`;
      const base64 = base64Data.split(",")[1];

      if (!base64) {
        console.warn(`No base64 data found for image at index ${i}`);
        continue;
      }

      try {
        const imageBuffer = Buffer.from(base64, "base64");

        // Validate buffer size
        if (imageBuffer.length === 0) {
          console.warn(`Empty image buffer for image at index ${i}`);
          continue;
        }

        // Create unique filename with proper extension
        const fileExtension = getFileExtensionFromMimeType(mimeType);
        const fileName = `image-${Date.now()}-${i}-${Math.random()
          .toString(36)
          .substr(2, 9)}.${fileExtension}`;
        const filePath = `${folderPath}/${fileName}`;

        console.log(
          `Attempting to upload: ${filePath}, Size: ${imageBuffer.length} bytes, MIME: ${mimeType}`
        );

        // Create upload promise
        const uploadPromise = supabase.storage
          .from("car-images")
          .upload(filePath, imageBuffer, {
            contentType: mimeType,
            upsert: false,
            cacheControl: "3600",
          })
          .then(({ data, error }) => {
            if (error) {
              console.error(`Error uploading image ${i}:`, error);
              throw new Error(`Failed to upload image ${i}: ${error.message}`);
            }

            console.log(`Successfully uploaded image ${i}:`, data);

            // Get the public URL for the uploaded file
            const { data: publicUrlData } = supabase.storage
              .from("car-images")
              .getPublicUrl(filePath);

            if (!publicUrlData?.publicUrl) {
              throw new Error(`Failed to get public URL for image ${i}`);
            }

            return publicUrlData.publicUrl;
          });

        uploadPromises.push(uploadPromise);
      } catch (bufferError) {
        console.error(
          `Error processing image buffer for index ${i}:`,
          bufferError
        );
        continue;
      }
    }

    if (uploadPromises.length === 0) {
      throw new Error("No valid images found to upload");
    }

    // Wait for all uploads to complete
    try {
      const uploadResults = await Promise.allSettled(uploadPromises);

      // Process results
      uploadResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          imageUrls.push(result.value);
        } else {
          console.error(`Upload failed for image ${index}:`, result.reason);
        }
      });

      if (imageUrls.length === 0) {
        throw new Error("All image uploads failed");
      }

      console.log(
        `Successfully uploaded ${imageUrls.length} out of ${uploadPromises.length} images`
      );
    } catch (uploadError) {
      console.error("Error during image uploads:", uploadError);
      throw new Error("Failed to upload images: " + uploadError.message);
    }

    // Log the carData to debug
    console.log("Car data before database insert:", {
      ...carData,
      price: parseFloat(carData.price),
      year: parseInt(carData.year),
      mileage: parseInt(carData.mileage),
    });

    // Add the car to the database with proper type conversions
    const car = await db.car.create({
      data: {
        id: carId,
        make: carData.make,
        model: carData.model,
        year: parseInt(carData.year) || 2024,
        price: parseFloat(carData.price),
        mileage: parseInt(carData.mileage) || 0,
        color: carData.color,
        fuelType: carData.fuelType,
        transmission: carData.transmission,
        bodyType: carData.bodyType,
        seats: carData.seats ? parseInt(carData.seats) : null,
        description: carData.description,
        status: carData.status || "AVAILABLE",
        featured: Boolean(carData.featured),
        images: imageUrls,
      },
    });

    console.log("Car successfully created:", car.id);

    // Revalidate the cars list page
    revalidatePath("/admin/cars");

    return {
      success: true,
      message: "Car added successfully!",
      carId: car.id,
      imagesUploaded: imageUrls.length,
    };
  } catch (error) {
    console.error("Full error details:", error);
    throw new Error("Error adding car: " + error.message);
  }
}

// Enhanced image loading component with error handling
export function ImageWithFallback({ src, alt, className, ...props }) {
  const [imgSrc, setImgSrc] = useState(src);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setImgSrc(src);
    setError(false);
    setLoading(true);
  }, [src]);

  const handleError = () => {
    console.error("Image failed to load:", src);
    setError(true);
    setLoading(false);
  };

  const handleLoad = () => {
    setLoading(false);
    setError(false);
  };

  if (error) {
    return (
      <div
        className={`bg-gray-200 flex items-center justify-center ${className}`}
      >
        <CarIcon className="h-6 w-6 text-gray-400" />
      </div>
    );
  }

  return (
    <div className="relative">
      {loading && (
        <div
          className={`absolute inset-0 bg-gray-200 animate-pulse ${className}`}
        />
      )}
      <img
        src={imgSrc}
        alt={alt}
        className={className}
        onError={handleError}
        onLoad={handleLoad}
        style={{ display: loading ? "none" : "block" }}
        {...props}
      />
    </div>
  );
}

// Helper function to validate and fix image URLs
export function validateAndFixImageUrl(url) {
  if (!url) return null;

  try {
    // Parse the URL to validate it
    const parsedUrl = new URL(url);

    // Check if it's a Supabase URL
    if (parsedUrl.hostname.includes("supabase.co")) {
      // Ensure proper path structure
      if (!parsedUrl.pathname.includes("/storage/v1/object/public/")) {
        console.warn("Invalid Supabase storage URL structure:", url);
        return null;
      }

      // Add cache busting parameter to avoid stale images
      parsedUrl.searchParams.set("t", Date.now().toString());
      return parsedUrl.toString();
    }

    return url;
  } catch (error) {
    console.error("Invalid image URL:", url, error);
    return null;
  }
}

// Enhanced delete function with better image cleanup
export async function deleteCar(id) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    // First, fetch the car to get its images
    const car = await db.car.findUnique({
      where: { id },
      select: { images: true },
    });

    if (!car) {
      return {
        success: false,
        error: "Car not found",
      };
    }

    // Delete the car from the database first
    await db.car.delete({
      where: { id },
    });

    // Delete the images from Supabase storage
    if (car.images && car.images.length > 0) {
      try {
        const supabase = createServiceSupabaseClient();

        // Extract file paths from image URLs more reliably
        const filePaths = car.images
          .map((imageUrl) => {
            try {
              const url = new URL(imageUrl);
              // Handle both old and new URL formats
              const pathMatch = url.pathname.match(
                /\/storage\/v1\/object\/public\/car-images\/(.*)|\/car-images\/(.*)/
              );
              return pathMatch ? pathMatch[1] || pathMatch[2] : null;
            } catch (urlError) {
              console.error("Error parsing image URL:", imageUrl, urlError);
              return null;
            }
          })
          .filter(Boolean);

        // Delete files from storage if paths were extracted
        if (filePaths.length > 0) {
          console.log("Deleting image files:", filePaths);

          const { error } = await supabase.storage
            .from("car-images")
            .remove(filePaths);

          if (error) {
            console.error("Error deleting images from storage:", error);
            // Continue execution even if storage deletion fails
          } else {
            console.log(
              `Successfully deleted ${filePaths.length} images from storage`
            );
          }
        }
      } catch (storageError) {
        console.error("Error with storage operations:", storageError);
        // Continue with the function even if storage operations fail
      }
    }

    // Revalidate the cars list page
    revalidatePath("/admin/cars");

    return {
      success: true,
      message: "Car and associated images deleted successfully",
    };
  } catch (error) {
    console.error("Error deleting car:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Gemini AI integration for car image processing
export async function processCarImageWithAI(file) {
  try {
    // Check if API key is available
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Gemini API key is not configured");
    }

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Convert image file to base64
    const base64Image = await fileToBase64(file);

    // Create image part for the model
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: file.type,
      },
    };

    // Define the prompt for car detail extraction
    const prompt = `
      Analyze this car image and extract the following information:
      1. Make (manufacturer)
      2. Model
      3. Year (approximately)
      4. Color
      5. Body type (SUV, Sedan, Hatchback, etc.)
      6. Mileage (best guess, use empty string if no estimate)
      7. Fuel type (best guess)
      8. Transmission type (best guess)
      9. Price (best guess, must be a positive number or empty string)
      10. Short Description for a car listing

      Format your response as a clean JSON object with these fields:
      {
        "make": "",
        "model": "",
        "year": 0,
        "color": "",
        "price": "",
        "mileage": "",
        "bodyType": "",
        "fuelType": "",
        "transmission": "",
        "description": "",
        "confidence": 0.0
      }

      For confidence, provide a value between 0 and 1 representing how confident you are in your overall identification.
      If you cannot estimate a field like price or mileage, return an empty string instead of 0.
      Only respond with the JSON object, nothing else.
    `;

    // Get response from Gemini
    const result = await model.generateContent([imagePart, prompt]);
    const response = await result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    // Parse the JSON response
    try {
      const carDetails = JSON.parse(cleanedText);

      // Validate the response format
      const requiredFields = [
        "make",
        "model",
        "year",
        "color",
        "bodyType",
        "price",
        "mileage",
        "fuelType",
        "transmission",
        "description",
        "confidence",
      ];

      const missingFields = requiredFields.filter(
        (field) => !(field in carDetails)
      );

      if (missingFields.length > 0) {
        throw new Error(
          `AI response missing required fields: ${missingFields.join(", ")}`
        );
      }

      // Return success response with data
      return {
        success: true,
        data: carDetails,
      };
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      console.log("Raw response:", text);
      return {
        success: false,
        error: "Failed to parse AI response",
      };
    }
  } catch (error) {
    console.error("Gemini API error:", error);
    throw new Error("Gemini API error: " + error.message);
  }
}

// Fetch all cars with simple search
export async function getCars(search = "") {
  try {
    // Build where conditions
    let where = {};

    // Add search filter
    if (search) {
      where.OR = [
        { make: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { color: { contains: search, mode: "insensitive" } },
      ];
    }

    // Execute main query
    const cars = await db.car.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const serializedCars = cars.map(serializeCarData);

    return {
      success: true,
      data: serializedCars,
    };
  } catch (error) {
    console.error("Error fetching cars:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Update car status or featured status
export async function updateCarStatus(id, { status, featured }) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const updateData = {};

    if (status !== undefined) {
      updateData.status = status;
    }

    if (featured !== undefined) {
      updateData.featured = featured;
    }

    // Update the car
    await db.car.update({
      where: { id },
      data: updateData,
    });

    // Revalidate the cars list page
    revalidatePath("/admin/cars");

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error updating car status:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

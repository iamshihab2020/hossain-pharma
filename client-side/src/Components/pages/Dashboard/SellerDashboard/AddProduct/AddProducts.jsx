import { useForm } from "react-hook-form";
import {
  Button,
  Typography,
  Input,
  Textarea,
} from "@material-tailwind/react";
import useAxiosPublic from "../../../../hooks/useAxiosPublic";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";
import Swal from "sweetalert2";
import { AuthContext } from "../../../../providers/AuthProvider";
import { useContext } from "react";
import SectionTittle from "../../../Shared/SectionTittle/SectionTittle";
import useCategory from "../../../../hooks/useCategory";

const image_hosting_key = import.meta.env.VITE_IMAGE_HOSTING_KEY;
const image_hosting_api = `https://api.imgbb.com/1/upload?key=${image_hosting_key}`;

const AddProducts = () => {
  const { user } = useContext(AuthContext);
  const { register, handleSubmit, reset } = useForm();
  const { categories, isLoading } = useCategory();

  const axiosPublic = useAxiosPublic();
  const axiosSecure = useAxiosSecure();

  const onSubmit = async (data) => {
    const imageFile = { image: data.image[0] };
    const res = await axiosPublic.post(image_hosting_api, imageFile, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    if (res.data.success) {
      const productsItem = {
        itemName: data.itemName,
        image: res.data.data.display_url,
        itemGenericName: data.itemGenericName,
        shortDescription: data.shortDescription,
        category: data.category,
        categoryTag: data.category.replace(/\s+/g, ""),
        company: data.company,
        itemMassUnit: data.itemMassUnit,
        perUnitPrice: parseFloat(data.perUnitPrice),
        pricePerPack: parseFloat(data.pricePerPack),
        discountPercentage: parseFloat(data.discountPercentage),
        storeName: data.storeName,
        email:user.email,
        sellerEmail: user.email,
      };

      const productsRes = await axiosSecure.post("/products", productsItem);

      if (productsRes.data.insertedId) {
        reset();
        Swal.fire({
          position: "top-end",
          icon: "success",
          title: `${data.itemName} is added to the website.`,
          showConfirmButton: false,
          timer: 1500,
        }).then(() => {
          window.location.reload();
        });
      }
    }

    console.log(res.data);
  };

  return (
    <div>
      <SectionTittle title={"Add Products"} />
      <div>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Product Name
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="text"
              placeholder="Product Name"
              {...register("itemName", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Product Generic Name
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="text"
              placeholder="Product Generic Name"
              {...register("itemGenericName", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2 ">
              Product Image
            </Typography>
            <input
              required
              className="max-w-full text-[#1F2B5B]"
              type="file"
              {...register("image", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Per Unit Price
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="number"
              placeholder="Per Unit Price"
              {...register("perUnitPrice", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Per Pack Price
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="number"
              placeholder="Per Pack Price"
              {...register("pricePerPack", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Category
            </Typography>
            {isLoading ? (
              <p>Loading categories...</p>
            ) : (
              <select
                {...register("category")}
                className="w-full py-2 text-base  border-gray-300 px-2 rounded-lg  border-2 text-[#1F2B5B]"
                >
                  <option>Select Category</option>
                  {categories.map((category) => (
                  
                  <option
                    key={category._id}
                    value={category.categoryName}
                  >
                    {category.categoryName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Product Description
            </Typography>
            <Textarea
              className="max-w-full"
              {...register("shortDescription", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Made By
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="text"
              placeholder="Made By"
              {...register("company", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Product Mass Unit
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="text"
              placeholder="Product Mass Units (MG/GM/KG)"
              {...register("itemMassUnit", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Discount Percentage
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="number"
              placeholder="Discount Percentage"
              {...register("discountPercentage", {})}
            />
          </div>

          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Store Name
            </Typography>
            <Input
              required
              defaultValue={user.displayName}
              disabled
              className="max-w-full text-[#1F2B5B]"
              type="text"
              placeholder="Store Name"
              {...register("storeName", {})}
            />
          </div>

          <Button className="mt-6 bg-[#3DBDEC]" fullWidth type="submit">
            Add Product
          </Button>
        </form>
      </div>
    </div>
  );
};

export default AddProducts;

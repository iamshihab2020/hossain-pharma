import { useForm } from "react-hook-form";
import { Button, Typography, Input, Textarea } from "@material-tailwind/react";
import useAxiosPublic from "../../../../hooks/useAxiosPublic";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";
import Swal from "sweetalert2";
import { AuthContext } from "../../../../providers/AuthProvider";
import { useContext } from "react";
import SectionTittle from "../../../Shared/SectionTittle/SectionTittle";

const image_hosting_key = import.meta.env.VITE_IMAGE_HOSTING_KEY;
const image_hosting_api = `https://api.imgbb.com/1/upload?key=${image_hosting_key}`;

const AddSellerAds = () => {
  const { user } = useContext(AuthContext);
  const { register, handleSubmit, reset } = useForm();

  const axiosPublic = useAxiosPublic();
  const axiosSecure = useAxiosSecure();

  const onSubmit = async (data) => {
    console.table(data);
    const imageFile = { image: data.image[0] };
    const res = await axiosPublic.post(image_hosting_api, imageFile, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    if (res.data.success) {
      const adsProductsItem = {
        itemName: data.itemName,
        image: res.data.data.display_url,
        shortDescription: data.shortDescription,
        company: data.company,
        perUnitPrice: parseFloat(data.perUnitPrice),
        pricePerPack: parseFloat(data.pricePerPack),
        discountPercentage: parseFloat(data.discountPercentage),
        storeName: user.displayName,
        email: user.email,
        sellerEmail: user.email,
        adsStatus: "pending",
      };

      const adsProductsRes = await axiosSecure.post(
        "/seller/ads",
        adsProductsItem
      );
      console.log(adsProductsRes.data);

      if (adsProductsRes.data.insertedId) {
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
      <SectionTittle title={"Request Advertisement"} />

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
            <Typography variant="h6" className="text-[#1F2B5B] mb-2 ">
              Product Image
            </Typography>
            <Input
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
            Request Advertisement
          </Button>
        </form>
      </div>
    </div>
  );
};

export default AddSellerAds;

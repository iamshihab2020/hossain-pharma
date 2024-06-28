import { useQuery } from "@tanstack/react-query";
import useAxiosPublic from "./useAxiosPublic";

const useProduct = (categoryTag) => {
  const axiosPublic = useAxiosPublic();

  const {
    data: products = [],
    isLoading: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["products", categoryTag],
    queryFn: async () => {
      let url = "https://hossain-farma-server.vercel.app/products";
      if (categoryTag) {
        url = `https://hossain-farma-server.vercel.app/products/category/${categoryTag}`;
      }
      const res = await axiosPublic.get(url);
      return res.data;
    },
    // enabled: !!categoryTag, // Optional: enable/disable the query based on categoryTag presence
  });

  return [products, loading, error, refetch];
};

export default useProduct;

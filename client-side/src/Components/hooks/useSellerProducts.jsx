import { useQuery } from "@tanstack/react-query";
import useAxiosSecure from "./useAxiosSecure";
import useAuth from "./useAuth";

const useSellerProducts = () => {
  const axiosSecure = useAxiosSecure();
  const { user } = useAuth();

  const { refetch, data: products = [] } = useQuery({
    queryKey: ["products", user?.email],
    queryFn: async () => {
      if (user?.email) {
        const res = await axiosSecure.get(`/products/seller/${user.email}`);
        return res.data;
      } else {
        return [];
      }
    },
    enabled: !!user?.email, 
  });

  return [products, refetch];
};

export default useSellerProducts;

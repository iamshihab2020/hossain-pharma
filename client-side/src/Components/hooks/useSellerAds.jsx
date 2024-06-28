import { useQuery } from "@tanstack/react-query";
import useAxiosSecure from "./useAxiosSecure";
import useAuth from "./useAuth";

const useSellerAds = () => {
  const axiosSecure = useAxiosSecure();
  const { user } = useAuth();

  const { refetch, data: adsProducts = [] } = useQuery({
    queryKey: ["adsProducts", user?.email],
    queryFn: async () => {
      if (user?.email) {
        const res = await axiosSecure.get(`/seller/ads/${user.email}`);
        return res.data;
      } else {
        return [];
      }
    },
    enabled: !!user?.email,
  });
  return [adsProducts, refetch];
};

export default useSellerAds;

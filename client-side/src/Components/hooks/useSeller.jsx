import { useQuery } from "@tanstack/react-query";
import useAuth from "./useAuth";
import useAxiosSecure from "./useAxiosSecure";

const useSeller = () => {
  const { user, loading } = useAuth();
  const axiosSecure = useAxiosSecure();
  const { data: isSeller, isPending: isSellerLoading } = useQuery({
    queryKey: [user?.email, "isSeller"],
    enabled: !loading,
    queryFn: async () => {
      const res = await axiosSecure.get(`/users/seller/${user.email}`);
      console.log(res.data);
      return res.data?.seller;
    },
  });
  return [isSeller, isSellerLoading];
};

export default useSeller;
